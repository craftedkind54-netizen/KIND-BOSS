# Promotion board update - v1.22.0

## Install

Replace the bot source using this project, then restart/redeploy it through your usual hosting workflow. If copying only changed runtime files, copy both `src/staffApplications.js` and the new `src/interviewQuestions.js` together. Keep your existing environment variables and persistent data volume. The source archive contains no live database or credentials. No new dependency or environment variable is required. The Minecraft plugin is unchanged.

This package has not been deployed or tested against a live Discord server. Automated tests use the production board functions and interaction branches with simulated Discord builders and check message limits. Run `npm test` and `npm run check` locally before deployment.

## Board behavior

Every new board is based on the selected target rank, for both normal applications and direct interviews. General Staff applying for Senior Staff receives Senior Staff questions in every tab. Each rank has a stable, distinct pool; repeated boards for the same rank reuse that pool, and interviewers choose three questions per category. This update does not promise unlimited never-repeated questions.

The welcome appears before `Next: First Category`. It includes rank-specific expectations and the supplied Crafted SMP welcome wording. Each of the nine categories then opens a brief before `Start Category` reveals its questions. These are interviewer-board prompts to read aloud; exact interview questions remain out of the applicant study guide. Applicant study topics are also rank-specific. The external study-guide document itself was not modified.

The eight core categories contain four questions each for each of six ranks (192 distinct core questions). The Bonus / Troll Check contains all eight user-supplied scenarios with distinct follow-ups for each rank (48 bonus variants). Choose three bonus prompts. Record maturity, composure, creativity and boundaries in notes; there are no bonus grade buttons and no bonus points. Core scoring remains out of 24. The Owner retains final Pass/Fail control.

## Source and judgment

Core questions use the supplied 26-page SMP rules.pdf, including Discord conduct, protected areas, legal anarchy, cheating, evidence, punishments, staff advantages, reporting abuse and unforeseen situations. Each category brief identifies relevant sections and pages. Bonus scenarios are fictional user-requested prompts, not SMP rules.

The PDF does not define detailed permission lists or duties for all six bot ranks, nor a strike-to-jail conversion. Rank difficulty builds on the rank focus already present in the original bot. Questions assess increasing responsibility without granting permissions or inventing punishment formulas. Staff must use their actual authorized access. Rule annotations should not be treated as an invented jail schedule.

## Compatibility

New question banks are saved with each interview so later edits do not silently change the questions behind saved selections. Boards not yet started use the updated bank when started. Already-started legacy boards keep their original eight core question pools and saved indices; when advanced, they can reach the new bonus category. Legacy boards already at the old Finish button can still finish without the bonus. New boards must complete the bonus before final submission.

A welcome already posted by the old running bot will not rewrite itself on deployment; create a new interview board to see the new opening. Do not delete persistent application data to refresh a board. Existing databases and scheduling/approval behavior are retained.

Final results include paginated question/notes details followed by a compact score and approval message. Notes retain the original display limit of 350 characters per interviewer per category; full saved notes stay in the database. Final free-text notes are included across detail pages.

## Verification

Seven automated tests cover all six rank banks and all nine tabs, rank-specific welcomes and study topics, General-to-Senior progression and alternating turns, saved/legacy question compatibility, Discord message size limits, unscored bonus behavior, and exact asked questions in final results. Syntax checks passed for every JavaScript runtime file.
