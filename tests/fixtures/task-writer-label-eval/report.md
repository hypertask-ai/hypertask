# Board label pilot: Jev against today's writer (HTPR-9047)

Jev typesafe/jev-1.14 answers one yes-or-no question per label in a single call, and we keep the labels it is at least 80.0% sure of. Today's writer claude-haiku-5-5 answers one prompt with the board label list cut to the 4000-character vocabulary budget. One more arm asks today's writer with the whole list, so the cut and the model stay apart.

Corpus: 200 board 15 tickets created before 2026-10-01, their labels hidden from every arm; 109 board labels, of which 52 are labels a writer sets and 59 fit in today's list.

## Result

| metric | Jev, whole label list | Jev, writer labels only | Today, capped list | Today, whole list |
| --- | --- | --- | --- | --- |
| tickets answered | 200 of 200 | 200 of 200 | 200 of 200 | 200 of 200 |
| recall (micro) | 42.0% | 42.4% | 42.8% | 37.5% |
| precision (micro) | 20.0% | 34.9% | 26.0% | 21.1% |
| F1 (micro) | 27.1% | 38.3% | 32.4% | 27.0% |
| labels right / picked | 111 / 556 | 112 / 321 | 113 / 434 | 99 / 469 |
| wrong labels added | 445 | 209 | 321 | 370 |
| tickets left with no label | 19 | 42 | 11 | 21 |
| latency p50 | 220ms | 199ms | 1701ms | 1845ms |
| cost for the run | $0.0211 | $0.0122 | $0.4280 | $0.5193 |
| errors | 0 | 0 | 0 | 0 |

Today's writer sees 59 of 109 labels, so 50 are cut off (45.9% of the board). 14 of the 264 labels on these tickets (5.3%) sit past the cut, where no prompt can return them.

## Confidence sweep, Jev with the whole label list

| keep at | recall | precision | F1 | labels picked | tickets left with no label |
| --- | --- | --- | --- | --- | --- |
| 50.0% | 74.6% | 7.6% | 13.9% | 2577 | 0 |
| 60.0% | 66.3% | 11.2% | 19.1% | 1565 | 0 |
| 70.0% | 57.2% | 15.1% | 23.9% | 999 | 4 |
| 80.0% | 42.0% | 20.0% | 27.1% | 556 | 19 |
| 90.0% | 19.7% | 29.2% | 23.5% | 178 | 81 |

## Verdict

### Jev with the whole board label list

- FAIL Jev finds more of the labels on the ticket: recall 42.0% against 42.8%
- FAIL Jev adds no more wrong labels: precision 20.0% against 26.0%
- FAIL Jev scores better overall: F1 27.1% against 32.4%
- PASS Jev answers nearly every ticket: 0 of 200 failed
- PASS Jev is not slower than today: p50 220ms against 1701ms

### Jev with only the labels a writer sets

- FAIL Jev finds more of the labels on the ticket: recall 42.4% against 42.8%
- PASS Jev adds no more wrong labels: precision 34.9% against 26.0%
- PASS Jev scores better overall: F1 38.3% against 32.4%
- PASS Jev answers nearly every ticket: 0 of 200 failed
- PASS Jev is not slower than today: p50 199ms against 1701ms

Verdict: DROP Jev. No Jev setup cleared every bar.

## Method

- The corpus is board 15 tickets created before the cutoff, and the labels the board already carries are the answer key. Labels stay out of every request; every arm gets the title and the first 1000 characters of the note.
- Jev gets one `noul` question per label, each answer one probability, kept at 0.8 for the verdict, the confidence Fable named for the live step.
- Today's arm is the writer's label decision: the label list and the ticket in one prompt, answered as label names, cut at 4000 characters the way `formatBoardVocabulary` cuts it.
- The verdict asks for more right labels and no more wrong ones than today, the bar the ticket sets.

## Limits

- Today's arm makes the writer's decision with a plainer prompt than the shipped one, so it is a stand-in rather than the shipped draft.
- A label a writer would add but nobody wanted counts as wrong, the same way a missed one does.
- The capped arm spends the whole 4000 characters on labels; the shipped vocabulary spends part of it on the project title, description and columns first, so production hides at least as many labels as measured here.
- The label list is alphabetical here; production order follows the database, so which labels fall past the cut can differ.
