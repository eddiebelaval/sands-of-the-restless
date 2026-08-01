/**
 * Player movement, collision, and head bob.
 *
 * Collision resolves against the flat cylinder array the world hands over.
 * Push-out is iterative rather than analytic: two passes catch the common case
 * of standing in the crease between two colliders without needing a real
 * physics solver.
 *
 * Every rate here is per second and multiplied by a clamped delta, so a
 * backgrounded tab that resumes with a 4-second frame does not teleport the
 * player through a wall.
 */

import * as THREE from 'three';

const EYE_HEIGHT = 1.68;
const RADIUS = 0.42;

const WALK_SPEED = 5.4;
const SPRINT_SPEED = 8.6;
const ACCEL = 42;          // ground acceleration, units/s^2
const FRICTION = 12;
const GRAVITY = 24;
const JUMP_VELOCITY = 7.4;

export function createPlayer(world) {
  const position = world.spawn.clone();
  position.y = EYE_HEIGHT;

  const velocity = new THREE.Vector3();

  const state = {
    position,
    velocity,
    grounded: true,
    sprinting: false,
    speed: 0,          // horizontal speed, read by the camera for bob and FOV
    bobPhase: 0,
    bobOffset: new THREE.Vector3(),
    health: 100,
    maxHealth: 100,
  };

  // Scratch vectors, allocated once. Allocating inside the frame loop is how
  // a smooth game becomes a stuttering one.
  const wish = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function update(dt, input, yaw) {
    // --- desired direction, in world space -------------------------------
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    wish.set(0, 0, 0)
      .addScaledVector(forward, input.forward)
      .addScaledVector(right, input.strafe);

    const moving = wish.lengthSq() > 0.0001;
    if (moving) wish.normalize();

    // Sprint only counts when actually moving forward. Sprinting backwards
    // into a horde should not be a strategy.
    state.sprinting = input.sprint && input.forward > 0 && moving;
    const target = state.sprinting ? SPRINT_SPEED : WALK_SPEED;

    // --- horizontal acceleration and friction -----------------------------
    if (moving) {
      velocity.x += wish.x * ACCEL * dt;
      velocity.z += wish.z * ACCEL * dt;

      const h = Math.hypot(velocity.x, velocity.z);
      if (h > target) {
        const s = target / h;
        velocity.x *= s;
        velocity.z *= s;
      }
    } else {
      const drop = FRICTION * dt;
      const h = Math.hypot(velocity.x, velocity.z);
      if (h > 0.0001) {
        const s = Math.max(0, h - drop * h) / h;
        velocity.x *= s;
        velocity.z *= s;
      } else {
        velocity.x = velocity.z = 0;
      }
    }

    // --- vertical ----------------------------------------------------------
    if (input.jump && state.grounded) {
      velocity.y = JUMP_VELOCITY;
      state.grounded = false;
    }

    if (!state.grounded) {
      velocity.y -= GRAVITY * dt;
    }

    // --- integrate ---------------------------------------------------------
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    position.z += velocity.z * dt;

    // The floor is a dune field outside and a set of ramps and ledges inside,
    // and both answer the same question: how high is the ground here. The third
    // argument is where the feet currently are, which is what lets the interior
    // sampler refuse to snap the player up onto a ledge they are walking
    // underneath. The dune sampler ignores it.
    const floor = (world.heightAt
      ? world.heightAt(position.x, position.z, position.y - EYE_HEIGHT)
      : 0) + EYE_HEIGHT;

    if (position.y <= floor) {
      position.y = floor;
      velocity.y = 0;
      state.grounded = true;
    } else if (position.y > floor + 0.02) {
      // Walking off the edge of the gallery's upper level is a fall. Without
      // this the player keeps whatever grounded state they had and strolls out
      // over the drop, because gravity only runs while airborne.
      state.grounded = false;
    }

    resolveCollisions();

    state.speed = Math.hypot(velocity.x, velocity.z);
    updateBob(dt);
  }

  /**
   * Push the player out of any cylinder they have entered. Two passes, because
   * escaping one collider can push you into its neighbour.
   */
  function resolveCollisions() {
    for (let pass = 0; pass < 2; pass++) {
      let hit = false;

      // Rooms first. A cylinder cannot approximate a wall without either
      // leaking at the corners or eating the doorway, so the interior hands
      // over axis-aligned boxes instead and they resolve in the same passes.
      if (world.walls) resolveWalls();

      const floorY = world.heightAt
        ? world.heightAt(position.x, position.z, position.y - EYE_HEIGHT)
        : 0;

      for (const c of world.colliders) {
        // A collider only blocks if the player's eye is below its top. Short
        // rubble can be stood beside but tall pillars cannot be walked through.
        //
        // Measured from the collider's own base where it declares one, and from
        // the local floor where it does not. Outside, props stand on dunes and
        // their base IS the local floor. Inside, the floor is flat but the room
        // is not: a column standing on the ground and carrying a ledge six units
        // up must stop blocking once the player is on top of that ledge.
        const base = c.y0 === undefined ? floorY : c.y0;
        const feetY = position.y - EYE_HEIGHT;

        // Above its top: the ledge case described above.
        if (feetY - base > c.h) continue;

        /**
         * AND BELOW ITS BASE, WHICH THIS TEST DID NOT HAVE.
         *
         * The rule was one-sided. It skipped a collider the actor had climbed ON
         * TOP OF and never one the actor was standing UNDERNEATH, so a cylinder
         * with no floor turned out to have no ceiling either: anything declaring
         * a raised base blocked the room beneath it all the way to the ground.
         *
         * The Altar of Ptah is what exposed it. It moved onto the gallery bridge
         * at y 6 and kept its 2.1-radius collider with y0 6, so it stood as an
         * invisible pillar in the middle of the largest room in the map - six
         * metres below itself, for the player as much as for the horde. Two of
         * the navigation lane's stuck actors died on it. From the floor it reads
         * as the game refusing to let you walk through a particular patch of
         * nothing, which is unattributable and therefore never gets reported.
         *
         * build.js already worked around this for elevated PROPS by throwing
         * their colliders away, with a comment saying it is waiting for exactly
         * this fix: "until the collider record grows a base height, elevated
         * props are decoration only". Interacts could not take that workaround,
         * because an interact is a solid object the player walks up to and buys
         * from and has to keep its collider. So the test grows its missing half
         * instead, and that prop workaround can now go whenever someone wants
         * decoration on an upper level to be solid.
         *
         * EYE_HEIGHT rather than a new head constant: the camera sits at the top
         * of the body in this controller, so a base higher than the eye is above
         * the whole of the player.
         */
        if (base - feetY > EYE_HEIGHT) continue;

        const dx = position.x - c.x;
        const dz = position.z - c.z;
        const distSq = dx * dx + dz * dz;
        const minDist = c.r + RADIUS;

        if (distSq < minDist * minDist && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) / dist;
          position.x += dx * push;
          position.z += dz * push;

          // Kill the velocity component heading into the surface, so the
          // player slides along it instead of sticking.
          const nx = dx / dist, nz = dz / dist;
          const into = velocity.x * nx + velocity.z * nz;
          if (into < 0) {
            velocity.x -= nx * into;
            velocity.z -= nz * into;
          }
          hit = true;
        }
      }

      if (!hit) break;
    }

    // Perimeter. The courtyard is a square and states one min and one max; the
    // interior is a long rectangle and states four sides. Reading both shapes
    // here is cheaper than making the square lie about being a rectangle.
    const b = world.bounds;
    const minX = b.minX ?? b.min, maxX = b.maxX ?? b.max;
    const minZ = b.minZ ?? b.min, maxZ = b.maxZ ?? b.max;

    if (position.x < minX) { position.x = minX; velocity.x = Math.max(0, velocity.x); }
    if (position.x > maxX) { position.x = maxX; velocity.x = Math.min(0, velocity.x); }
    if (position.z < minZ) { position.z = minZ; velocity.z = Math.max(0, velocity.z); }
    if (position.z > maxZ) { position.z = maxZ; velocity.z = Math.min(0, velocity.z); }
  }

  /**
   * Push the player out of any wall box they have entered.
   *
   * Resolution is along the axis of LEAST penetration, which is what makes a
   * player who clips a wall while running along it slide rather than get
   * launched sideways through the room.
   *
   * The vertical test is what lets a doorway work. The stone above an opening
   * is a wall record too, standing from the door head to the ceiling, and a
   * player whose whole body is below it must pass under it untouched.
   */
  function resolveWalls() {
    const feet = position.y - EYE_HEIGHT;
    const head = feet + EYE_HEIGHT + 0.12;

    for (const w of world.walls) {
      if (head <= w.y0 || feet >= w.y1) continue;

      const hx = w.w / 2 + RADIUS;
      const hz = w.d / 2 + RADIUS;

      const dx = position.x - w.x;
      const dz = position.z - w.z;

      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px <= 0 || pz <= 0) continue;

      if (px < pz) {
        const s = dx < 0 ? -1 : 1;
        position.x += px * s;
        if (velocity.x * s < 0) velocity.x = 0;
      } else {
        const s = dz < 0 ? -1 : 1;
        position.z += pz * s;
        if (velocity.z * s < 0) velocity.z = 0;
      }
    }
  }

  /**
   * Head bob driven by real velocity, not a free-running timer. Standing still
   * stops the bob dead, which is what sells it as footsteps rather than a
   * wobble effect bolted on top.
   */
  function updateBob(dt) {
    const speed = state.speed;

    if (speed > 0.4) {
      state.bobPhase += dt * (speed * 1.55);
      const amp = Math.min(speed / SPRINT_SPEED, 1) * 0.055;

      // Vertical bobs at twice the horizontal rate: one dip per footfall,
      // one sway per stride.
      state.bobOffset.set(
        Math.cos(state.bobPhase) * amp * 0.6,
        Math.abs(Math.sin(state.bobPhase)) * -amp,
        0
      );
    } else {
      // Ease back to neutral rather than snapping.
      state.bobOffset.multiplyScalar(Math.max(0, 1 - dt * 8));
    }
  }

  return {
    state,
    position,
    velocity,
    update,

    damage(n) {
      state.health = Math.max(0, state.health - n);
      return state.health;
    },

    heal(n) {
      state.health = Math.min(state.maxHealth, state.health + n);
    },

    /**
     * Put the player somewhere. `v.y` is the FLOOR they arrive standing on, not
     * the eye - the eye is added here, because a caller that had to know
     * EYE_HEIGHT would be a second copy of it.
     *
     * It used to force y to the eye height unconditionally, which meant the one
     * thing teleport could not do was reach an upper level. That was invisible
     * while the gallery's ledges were two dead-end shelves nothing needed to be
     * placed on; with the bridge joined and the Altar of Ptah standing on it,
     * "ground floor only" is a hole. Every existing caller passes y: 0 and is
     * therefore unchanged to the millimetre.
     */
    teleport(v) {
      position.copy(v);
      position.y = (v.y || 0) + EYE_HEIGHT;
      velocity.set(0, 0, 0);
    },
  };
}

export const PLAYER_CONSTANTS = { EYE_HEIGHT, RADIUS, WALK_SPEED, SPRINT_SPEED };
