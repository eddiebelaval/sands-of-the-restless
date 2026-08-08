# World 2: the plan

Owner decisions, 2026-08-08, taken verbatim and not negotiated:

- **World 2 starts FRESH.** Same guns, same rules, everything. No carry-over.
- **One exception, and it is an Easter egg.** Do something specific and hidden -
  "in the back of a stair or something" - and your pack-a-punched gun comes with
  you. **It has to be hard to find. The Easter egg has to be real.**
- World 2 does not begin until World 1 polish is finished.

---

## Why "fresh" is the right call, and what it costs

A run that carries its arsenal forward has to be balanced against a player who
might arrive with anything, which in practice means balancing against the best
case and punishing everyone else. Starting fresh means World 2's first wave can
be tuned exactly as tightly as World 1's was, and the pistol means the same thing
in both places.

What it costs is continuity, and that cost is real: the player just spent an hour
building something and the game takes it away at the door. Which is precisely
what makes the Easter egg worth having - it is not a shortcut, it is the answer
to a complaint the player is entitled to have.

## The Easter egg, and the bar it has to clear

"Real" is the whole specification and it rules out most of what usually gets
built here:

- **Not a menu toggle, not a difficulty setting, not an unlock that announces
  itself.** Nothing on any surface says it exists.
- **Not random.** It must be repeatable by someone who worked it out, and
  explicable afterwards. An egg you cannot teach a friend to do is a bug.
- **Discoverable from inside the world.** The clue is in geometry, dressing or
  audio that is already there, or that gets added as set dressing with no label.
- **It must survive being found.** Once known it should still take doing.

The mechanical hook already exists and is one line: `ui/ending.js:descend()`
fires `onDescend` listeners and holds the screen black. Whatever the egg sets,
that listener reads. Nothing about the egg touches the ending's own sequence.

The place the owner pointed at - the back of a stair - is worth taking
literally. The Serdab is the only room in twenty-five waves with no spawn
points, it already sits behind a puzzle portal, and its art lane is unbuilt (five
prop slots, zero interacts, ten figures and an archaeologist authored but not
placed). It is the one room in World 1 where a player can be alone long enough to
notice something. **HARD FLAG: `star-shaft -> serdab` clears the doorway rule with
exactly zero slack, so nothing here may change the Serdab's floor or ceiling.**

The specific action is the owner's call, not mine. My recommendation is that it
be a SEQUENCE rather than a hidden switch - something done in an order, in a
room, that no accident produces - because a switch is found by brushing every
wall and a sequence has to be understood.

## What World 2 inherits from World 1

Settled, and mostly by having been built properly the first time:

- the wave director, the boss ladder, the flow field, the economy
- the objective ladder (`ui/objective.js`), which is generic over rooms
- the depth readout and minimap storeys
- the ending card's shape, which the World 2 ending should ECHO rather than reuse

What it must NOT inherit is World 1's mistake of having an ending and no middle.
See `docs/WORLD1-POLISH.md` item 5: the story work happens in World 1 first, and
World 2 is written knowing how a middle is built.

## Order of work

World 2 does not start until the polish list is done. When it does:

1. The bridge: what `onDescend` hands over, and the Easter egg's flag.
2. The map, at greybox, walkable, before any dressing.
3. The wave ladder retuned for a fresh armoury.
4. New enemies from World 1's late-wave work, plus World 2's own.
5. Dressing, audio, the ending.
