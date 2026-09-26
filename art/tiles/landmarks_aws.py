"""
Bespoke landmarks: one drawer per AWS service, lm_<serviceId>(fw, fh, tier, col, key) -> Canvas.

Each drawer echoes the service's official Architecture Icon motif and its city metaphor (shared/world.json
`place`), in the team pack's style (1px navy outline from Canvas.finish, AWS navy/orange, pack greys), keeps
the @lights layer (lface/rface light=True or c.ld) and adds detail with every tier 1-4.

The drawers live in three modules by district pair; this module collects every lm_* function into BESPOKE,
which generate_tiles.build_landmarks dispatches to before the generic KINDS fallback.
tests/art.test.ts checks that every service id in shared/world.json has a `def lm_<id>(`.
"""
import landmarks_aws_a
import landmarks_aws_b
import landmarks_aws_c

BESPOKE = {}
for _m in (landmarks_aws_a, landmarks_aws_b, landmarks_aws_c):
    for _name in dir(_m):
        if _name.startswith("lm_") and callable(getattr(_m, _name)):
            _id = _name[3:]
            if _id in BESPOKE:
                raise ValueError(f"two drawers for {_id}")
            BESPOKE[_id] = getattr(_m, _name)
