// For tests only: a throwaway Valkey container from the cluster's image, with the
// cluster's user list loaded, so tests run against the same permissions (D46).
// Needs Docker. Imported as "@exhibition/shared/testing".
import { RedisClient } from "bun";

const root = new URL("../../../", import.meta.url);

// The password every user gets in the test container.
export const TEST_PASSWORD = "test-password";

export type TestValkey = {
  // host:port on 127.0.0.1
  address: string;
  // A connection as the admin user, for setting up and inspecting keys.
  admin: RedisClient;
  // The URL for logging in as one of the users in users.acl.
  url: (user: string) => string;
  stop: () => void;
};

export async function startValkey(): Promise<TestValkey> {
  // The same image as the cluster's, read from the StatefulSet's valkey container.
  const statefulSet = Bun.YAML.parse(
    await Bun.file(new URL("deploy/base/valkey/statefulset.yaml", root)).text(),
  ) as { spec?: { template?: { spec?: { containers?: { name: string; image: string }[] } } } };
  const image = statefulSet.spec?.template?.spec?.containers?.find((c) => c.name === "valkey")?.image;
  if (!image) throw new Error("statefulset.yaml has no container named valkey with an image");

  const containerId = docker("run", "-d", "--rm", "-p", "127.0.0.1:0:6379", image);
  try {
    const address = docker("port", containerId, "6379").split("\n")[0]!;

    // Load the users as the start-up script does (D50): drop comments, fill in passwords.
    // ACL SETUSER takes the same rules as a line of the user list. This connection logs
    // in as the default user, so that user is changed last, through a connection as admin.
    const lines = (await Bun.file(new URL("deploy/base/valkey/users.acl", root)).text())
      .split("\n")
      .filter((line) => line.startsWith("user "))
      .map((line) => line.replace(/\{\{\w+\}\}/g, TEST_PASSWORD).split(/\s+/).slice(1));
    if (!lines.some(([name]) => name === "admin")) {
      throw new Error("users.acl has no admin user, which these tests log in as");
    }

    const setup = await connect(`valkey://${address}`);
    for (const [name, ...rules] of lines.filter(([name]) => name !== "default")) {
      await setup.send("ACL", ["SETUSER", name!, ...rules]);
    }
    setup.close();
    const admin = await connect(`valkey://admin:${TEST_PASSWORD}@${address}`);
    for (const [, ...rules] of lines.filter(([name]) => name === "default")) {
      await admin.send("ACL", ["SETUSER", "default", ...rules]);
    }

    return {
      address,
      admin,
      url: (user) => `valkey://${user}:${TEST_PASSWORD}@${address}`,
      stop: () => {
        admin.close();
        docker("rm", "-f", containerId);
      },
    };
  } catch (error) {
    docker("rm", "-f", containerId);
    throw error;
  }
}

function docker(...args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`docker ${args[0]} failed (is Docker running?): ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

// Connects once Valkey has started, retrying for up to ten seconds.
async function connect(url: string): Promise<RedisClient> {
  for (let attempt = 0; ; attempt++) {
    const client = new RedisClient(url, { autoReconnect: false });
    try {
      await client.send("PING", []);
      return client;
    } catch (error) {
      client.close();
      if (attempt >= 50) throw error;
      await Bun.sleep(200);
    }
  }
}
