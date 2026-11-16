# Development loop: builds images, deploys to the local cluster, live-updates code (D2).

# Only ever deploy to the local cluster from cluster.yaml, never to another one.
allow_k8s_contexts('k3d-exhibition')

# The API key's Secret, created from .env at the repository root (D27).
# quiet and echo_off keep the key out of Tilt's logs.
if not os.path.exists('.env'):
    fail('No .env file. Copy .env.example to .env and put your API key in it.')
# Tilt can't see which files a local() command reads; this re-runs the
# Tiltfile, and so updates the Secret, whenever .env changes.
watch_file('.env')
k8s_yaml(local(
    'kubectl create secret generic llm-api --namespace exhibition '
    + '--from-env-file=.env --dry-run=client -o yaml',
    quiet=True,
    echo_off=True,
))

# Everything else comes from the Kustomize overlay for the local cluster (D10).
k8s_yaml(kustomize('deploy/overlays/local'))
