--------------------------- MODULE SeatBilling ---------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Workers, MutatingRuns, Quantities

ASSUME /\ Workers # {} /\ MutatingRuns \subseteq Workers
       /\ Quantities # {} /\ Quantities \subseteq {1, 2}

RunKind(w) == IF w \in MutatingRuns THEN "mutate" ELSE "reconcile"

VARIABLES seats, billed, lock, lost, phase, desired, seen, pending, writeSeen, editedSinceRun, lastRun

vars == <<seats, billed, lock, lost, phase, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

Quiet == /\ lock = 0
         /\ \A w \in Workers : phase[w] \in {"idle", "done"}
         /\ \A w \in Workers : pending[w] = 0

LastRunReconciled == lastRun # 0 /\ RunKind(lastRun) = "reconcile"

InWindow(w) == phase[w] \in {"edit", "read", "readItem", "decide", "await"}

Init == /\ seats = 1
        /\ billed = 1
        /\ lock = 0
        /\ lost = [w \in Workers |-> FALSE]
        /\ phase = [w \in Workers |-> "idle"]
        /\ desired = [w \in Workers |-> 1]
        /\ seen = [w \in Workers |-> 1]
        /\ pending = [w \in Workers |-> 0]
        /\ writeSeen = [w \in Workers |-> 1]
        /\ editedSinceRun = FALSE
        /\ lastRun = 0

Acquire(w) == /\ phase[w] \in {"idle", "done"}
              /\ lock = 0
              /\ lock' = w
              /\ lost' = [lost EXCEPT ![w] = FALSE]
              /\ phase' = [phase EXCEPT ![w] = IF RunKind(w) = "mutate" THEN "edit" ELSE "read"]
              /\ UNCHANGED <<seats, billed, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

EditSeats(w) == /\ phase[w] = "edit"
                /\ ~lost[w]
                /\ \E q \in Quantities : seats' = q
                /\ editedSinceRun' = TRUE
                /\ phase' = [phase EXCEPT ![w] = "read"]
                /\ UNCHANGED <<billed, lock, lost, desired, seen, pending, writeSeen, lastRun>>

ReadDesired(w) == /\ phase[w] = "read"
                  /\ desired' = [desired EXCEPT ![w] = seats]
                  /\ phase' = [phase EXCEPT ![w] = "readItem"]
                  /\ UNCHANGED <<seats, billed, lock, lost, seen, pending, writeSeen, editedSinceRun, lastRun>>

ReadItem(w) == /\ phase[w] = "readItem"
               /\ seen' = [seen EXCEPT ![w] = billed]
               /\ phase' = [phase EXCEPT ![w] = "decide"]
               /\ UNCHANGED <<seats, billed, lock, lost, desired, pending, writeSeen, editedSinceRun, lastRun>>

NoWrite(w) == /\ phase[w] = "decide"
              /\ \/ desired[w] = seen[w]
                 \/ RunKind(w) = "mutate" /\ desired[w] < seen[w]
              /\ phase' = [phase EXCEPT ![w] = "release"]
              /\ UNCHANGED <<seats, billed, lock, lost, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

Write(w) == /\ phase[w] = "decide"
            /\ desired[w] # seen[w]
            /\ ~(RunKind(w) = "mutate" /\ desired[w] < seen[w])
            /\ ~lost[w]
            /\ pending' = [pending EXCEPT ![w] = desired[w]]
            /\ writeSeen' = [writeSeen EXCEPT ![w] = seen[w]]
            /\ phase' = [phase EXCEPT ![w] = "await"]
            /\ UNCHANGED <<seats, billed, lock, lost, desired, seen, editedSinceRun, lastRun>>

Landed(w) == /\ pending[w] # 0
             /\ billed' = pending[w]
             /\ pending' = [pending EXCEPT ![w] = 0]
             /\ UNCHANGED <<seats, lock, lost, phase, desired, seen, writeSeen, editedSinceRun, lastRun>>

Answered(w) == /\ phase[w] = "await"
               /\ pending[w] = 0
               /\ ~lost[w]
               /\ phase' = [phase EXCEPT ![w] = "release"]
               /\ UNCHANGED <<seats, billed, lock, lost, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

TimedOut(w) == /\ phase[w] = "await"
               /\ pending[w] # 0
               /\ phase' = [phase EXCEPT ![w] = "release"]
               /\ UNCHANGED <<seats, billed, lock, lost, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

LeaseLost(w) == /\ lock = w
                /\ ~lost[w]
                /\ lock' = 0
                /\ lost' = [lost EXCEPT ![w] = TRUE]
                /\ UNCHANGED <<seats, billed, phase, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

Abort(w) == /\ lost[w]
            /\ InWindow(w) \/ phase[w] = "release"
            /\ phase' = [phase EXCEPT ![w] = "done"]
            /\ UNCHANGED <<seats, billed, lock, lost, desired, seen, pending, writeSeen, editedSinceRun, lastRun>>

Release(w) == /\ phase[w] = "release"
              /\ lock = w
              /\ lock' = 0
              /\ phase' = [phase EXCEPT ![w] = "done"]
              /\ lastRun' = w
              /\ editedSinceRun' = FALSE
              /\ UNCHANGED <<seats, billed, lost, desired, seen, pending, writeSeen>>

Next == \E w \in Workers :
          \/ Acquire(w) \/ EditSeats(w) \/ ReadDesired(w) \/ ReadItem(w)
          \/ NoWrite(w) \/ Write(w) \/ Landed(w) \/ Answered(w) \/ TimedOut(w)
          \/ LeaseLost(w) \/ Abort(w) \/ Release(w)

Spec == Init /\ [][Next]_vars

JoinNeverDecreases == \A w \in Workers : pending[w] # 0 /\ RunKind(w) = "mutate" => pending[w] > writeSeen[w]

ReconcileMatchesSeats == Quiet /\ LastRunReconciled /\ ~editedSinceRun => billed = seats

LeaseExcludesOverlap == Cardinality({w \in Workers : InWindow(w)}) <= 1

=============================================================================
