# KindBossBridge 1.2.7 candidate

- Fixed team membership sync to find KindCore's inherited `store` field through its superclass chain.
- Fixed staff bounty approvals to call `handleBountyDecision` on KindCore's `BountyManager` instead of looking for it on the main plugin object.
- Bounty rules and reward handling are unchanged.
- The Railway HTTP 401 is separate: the `bridge-secret` in MineKeep's KindBossBridge config must match the active `BRIDGE_SECRET` in Railway.
- Validation: pending build and live approval/team-sync check.

