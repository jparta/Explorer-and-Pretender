# Glossary

The terms the project uses, defined in one place. Other documents use them as defined here and don't define them again. Technical terms that belong to one phase's design are defined in that phase's architecture doc.

Explorer, Pretender, Codeword and Session are always capitalised.

## The exhibition

- **Exhibition:** the whole work: the website and the Sessions it shows.
- **Explorer:** the LLM that searches for the Codeword. It is told only that it must find the Codeword.
- **Pretender:** the LLM that pretends to be an interface and hides the Codeword.
- **Kind:** what a Pretender pretends to be. Phase 1 has one kind, the terminal; more come in Phase 3.
- **Codeword:** a phrase of the form adjective-noun-verb, such as `verbose-keepalive-hibernates`, new for each Session and given only to the Pretender.
- **Session:** one interaction between the Explorer and the Pretender, from the Explorer's first message to the Session's ending.
- **Message:** what the Explorer or the Pretender writes in one turn.
- **Exchange:** one Explorer message plus the Pretender's answer.
- **Ending:** how a Session ends.
  - *Found:* an Explorer message contains the Codeword.
  - *Ran its course:* the turn cap was reached without the Codeword being found.
  - *Interrupted:* the Session could not continue, for example because the model provider kept failing.
- **Sleeping:** the state of the exhibition from the moment the daily spend cap or the provider's daily key limit is reached, or the provider's prepaid credit runs out (D59), until the day resets at midnight UTC. No new Sessions start, and idle slots show the notice "Machine is sleeping, come back tomorrow".

## The website

- **Carousel:** the looping row of slots that a viewer scrolls through.
- **Slot:** a place in the carousel. It shows at most one Session at a time.
- **In focus:** the slot the carousel has snapped to. Each page has exactly one.
- **Idle:** a slot with no Session running, not in an intermission and not sleeping. It waits for someone to watch it.
- **Intermission:** the short wait in a slot between one Session's end and the next one's start.
- **Viewer:** anyone with the exhibition open in a browser. *Visitor* means the same.
- **Present:** a viewer is present while the exhibition is open in an active browser tab.
- **Watching:** a present viewer is watching the slot in focus.
- **Style:** the look of a slot's card, one per kind, defined as a set of theme tokens.
