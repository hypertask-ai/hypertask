--------------------------- MODULE ChatSendQueue ---------------------------
EXTENDS Naturals, Sequences, TLC

CONSTANTS Messages, Sessions, MessageSession, MaxWait,
          BugLostQueued, BugSwitchClears, BugStopLeavesOpen, BugNoAcquisitionBound

ASSUME /\ Messages # {}
       /\ Messages \subseteq Nat
       /\ Sessions # {}
       /\ MessageSession \in Sessions
       /\ MaxWait \in Nat
       /\ MaxWait >= 1
       /\ BugLostQueued \in BOOLEAN
       /\ BugSwitchClears \in BOOLEAN
       /\ BugStopLeavesOpen \in BOOLEAN
       /\ BugNoAcquisitionBound \in BOOLEAN

VARIABLES state, composer, queue, active, inflight, stream, stopped,
          delivered, ord, nextOrd, retry, poll, slot, waited, attempts, callbacks

vars == <<state, composer, queue, active, inflight, stream, stopped,
          delivered, ord, nextOrd, retry, poll, slot, waited, attempts, callbacks>>

Typed(m) == state[m] \in {"queued", "sending", "acked", "done", "lost"}

HeadSent == queue[active] # <<>> /\ Head(queue[active]) = inflight

Init == /\ state = [m \in Messages |-> "idle"]
        /\ composer = 0
        /\ queue = [s \in Sessions |-> <<>>]
        /\ active = MessageSession
        /\ inflight = 0
        /\ stream = "idle"
        /\ stopped = FALSE
        /\ delivered = [m \in Messages |-> FALSE]
        /\ ord = [m \in Messages |-> 0]
        /\ nextOrd = 1
        /\ retry = [m \in Messages |-> FALSE]
        /\ poll = "idle"
        /\ slot = 1
        /\ waited = 0
        /\ attempts = 0
        /\ callbacks = 0

Compose(m) == /\ active = MessageSession
              /\ composer = 0
              /\ state[m] = "idle"
              /\ composer' = m
              /\ state' = [state EXCEPT ![m] = "draft"]
              /\ UNCHANGED <<queue, active, inflight, stream, stopped, delivered, ord, nextOrd, retry,
                             poll, slot, waited, attempts, callbacks>>

Enqueue(m) == /\ state[m] = "draft"
              /\ composer = m
              /\ queue' = [queue EXCEPT ![MessageSession] = Append(@, m)]
              /\ state' = [state EXCEPT ![m] = "queued"]
              /\ ord' = [ord EXCEPT ![m] = nextOrd]
              /\ nextOrd' = nextOrd + 1
              /\ composer' = 0
              /\ UNCHANGED <<active, inflight, stream, stopped, delivered, retry,
                             poll, slot, waited, attempts, callbacks>>

SendQueued(m) == /\ active = MessageSession
                 /\ inflight = 0
                 /\ queue[active] # <<>>
                 /\ m = Head(queue[active])
                 /\ state[m] = "queued"
                 /\ inflight' = m
                 /\ state' = [state EXCEPT ![m] = "sending"]
                 /\ stream' = "open"
                 /\ stopped' = FALSE
                 /\ retry' = [retry EXCEPT ![m] = FALSE]
                 /\ IF BugLostQueued
                    THEN queue' = [queue EXCEPT ![active] = Tail(@)]
                    ELSE queue' = queue
                 /\ UNCHANGED <<composer, active, delivered, ord, nextOrd,
                                poll, slot, waited, attempts, callbacks>>

Accept == /\ inflight # 0
          /\ state[inflight] = "sending"
          /\ state' = [state EXCEPT ![inflight] = "acked"]
          /\ delivered' = [delivered EXCEPT ![inflight] = TRUE]
          /\ UNCHANGED <<composer, queue, active, inflight, stream, stopped, ord, nextOrd, retry,
                         poll, slot, waited, attempts, callbacks>>

Refuse == /\ inflight # 0
          /\ state[inflight] = "sending"
          /\ state' = [state EXCEPT ![inflight] = IF BugLostQueued THEN "lost" ELSE "queued"]
          /\ retry' = [retry EXCEPT ![inflight] = TRUE]
          /\ inflight' = 0
          /\ stream' = "idle"
          /\ UNCHANGED <<composer, queue, active, stopped, delivered, ord, nextOrd,
                         poll, slot, waited, attempts, callbacks>>

ReplyEnd == /\ inflight # 0
            /\ state[inflight] = "acked"
            /\ state' = [state EXCEPT ![inflight] = "done"]
            /\ queue' = [queue EXCEPT ![active] = IF HeadSent THEN Tail(queue[active]) ELSE queue[active]]
            /\ inflight' = 0
            /\ stream' = "closed"
            /\ UNCHANGED <<composer, active, stopped, delivered, ord, nextOrd, retry,
                           poll, slot, waited, attempts, callbacks>>

Stop == /\ inflight # 0
        /\ state[inflight] = "acked"
        /\ stopped' = TRUE
        /\ IF BugStopLeavesOpen
           THEN UNCHANGED <<inflight, stream, state, queue>>
           ELSE /\ state' = [state EXCEPT ![inflight] = "done"]
                /\ queue' = [queue EXCEPT ![active] = IF HeadSent THEN Tail(queue[active]) ELSE queue[active]]
                /\ inflight' = 0
                /\ stream' = "closed"
        /\ UNCHANGED <<composer, active, delivered, ord, nextOrd, retry,
                       poll, slot, waited, attempts, callbacks>>

Switch(s) == /\ s \in Sessions
             /\ active # s
             /\ active' = s
             /\ IF BugSwitchClears
                THEN /\ queue' = [t \in Sessions |-> <<>>]
                     /\ state' = [m \in Messages |-> IF state[m] = "queued" THEN "lost" ELSE state[m]]
                ELSE /\ queue' = queue
                     /\ state' = state
             /\ UNCHANGED <<composer, inflight, stream, stopped, delivered, ord, nextOrd, retry,
                            poll, slot, waited, attempts, callbacks>>

AcquisitionDeadline == MaxWait + (IF BugNoAcquisitionBound THEN 1 ELSE 0)

PollStart == /\ poll = "idle"
             /\ poll' = "waiting"
             /\ waited' = 0
             /\ attempts' = 1
             /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                            delivered, ord, nextOrd, retry, slot, callbacks>>

PollWait == /\ poll = "waiting"
            /\ slot = 1
            /\ waited < MaxWait + (IF BugNoAcquisitionBound THEN 1 ELSE 0)
            /\ waited' = waited + 1
            /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                           delivered, ord, nextOrd, retry, poll, slot, attempts, callbacks>>

PollAcquire == /\ poll = "waiting"
               /\ slot = 0
               /\ poll' = "reading"
               /\ slot' = 1
               /\ callbacks' = callbacks + 1
               /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                              delivered, ord, nextOrd, retry, waited, attempts>>

PollRead == /\ poll = "reading"
            /\ poll' = "done"
            /\ slot' = 0
            /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                           delivered, ord, nextOrd, retry, waited, attempts, callbacks>>

PollTimeout == /\ poll = "waiting"
               /\ slot = 1
               /\ waited = AcquisitionDeadline
               /\ waited' = 0
               /\ IF BugNoAcquisitionBound \/ attempts = 2
                  THEN /\ poll' = "done"
                       /\ attempts' = attempts
                  ELSE /\ poll' = "waiting"
                       /\ attempts' = attempts + 1
               /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                              delivered, ord, nextOrd, retry, slot, callbacks>>

PollRelease == /\ slot = 1
               /\ poll # "reading"
               /\ slot' = 0
               /\ UNCHANGED <<state, composer, queue, active, inflight, stream, stopped,
                              delivered, ord, nextOrd, retry, poll, waited, attempts, callbacks>>

Next == \/ \E m \in Messages : Compose(m)
        \/ \E m \in Messages : Enqueue(m)
        \/ \E m \in Messages : SendQueued(m)
        \/ Accept
        \/ Refuse
        \/ ReplyEnd
        \/ Stop
        \/ \E s \in Sessions : Switch(s)
        \/ PollStart
        \/ PollWait
        \/ PollAcquire
        \/ PollRead
        \/ PollTimeout
        \/ PollRelease

Spec == Init /\ [][Next]_vars

NoQueuedMessageLost == \A m \in Messages : Typed(m) => state[m] # "lost"

FailedSendKeepsQueued == \A m \in Messages : retry[m] => state[m] \in {"queued", "sending"}

ChatSwitchKeepsQueue == active # MessageSession => \A m \in Messages : Typed(m) => state[m] # "lost"

QueueOrderKept == \A m \in Messages : delivered[m] =>
                    \A n \in Messages : ord[n] # 0 /\ ord[n] < ord[m] => delivered[n]

StoppedReleasesSend == stopped => inflight = 0

StoppedStreamCloses == stopped => stream = "closed"

ReplyEndReleasesSend == inflight # 0 => state[inflight] # "done"

AcquisitionBounded == poll = "waiting" => waited <= MaxWait

AcquisitionNotReplayed == callbacks <= 1

=============================================================================
