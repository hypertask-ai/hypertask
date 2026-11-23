--------------------------- MODULE ChatSendQueue ---------------------------
EXTENDS Naturals, Sequences, TLC

CONSTANTS Messages, Sessions, MessageSession,
          MaxWait, RequiredWait, RetryPolicy,
          BackdateQueued, BugSwitchClears, BugStopLeavesOpen

ASSUME /\ Messages # {}
       /\ Messages \subseteq Nat
       /\ Sessions # {}
       /\ MessageSession \in Sessions
       /\ MaxWait \in Nat
       /\ MaxWait >= 1
       /\ RequiredWait \in Nat
       /\ RequiredWait >= 1
       /\ RetryPolicy \in {"none", "acquisition", "always"}
       /\ BackdateQueued \in BOOLEAN
       /\ BugSwitchClears \in BOOLEAN
       /\ BugStopLeavesOpen \in BOOLEAN

VARIABLES composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
          acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
          poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp

vars == <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
          acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
          poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

InQueue(m) == \E s \in Sessions : \E i \in 1..Len(queue[s]) : queue[s][i] = m

HeldHead == inflight # 0 /\ queue[inflightSession] # <<>> /\ Head(queue[inflightSession]) = inflight

HeldRemoved == [queue EXCEPT ![inflightSession] =
                  IF HeldHead THEN Tail(queue[inflightSession]) ELSE queue[inflightSession]]

Present(m) == (IF InQueue(m) /\ inflight # m THEN 1 ELSE 0)
            + (IF inflight = m THEN 1 ELSE 0)
            + (IF settled[m] THEN 1 ELSE 0)

Init == /\ composer = 0
        /\ entered = [m \in Messages |-> FALSE]
        /\ queue = [s \in Sessions |-> <<>>]
        /\ ord = [m \in Messages |-> 0]
        /\ nextOrd = 1
        /\ active = MessageSession
        /\ inflight = 0
        /\ inflightSession = MessageSession
        /\ acked = [m \in Messages |-> FALSE]
        /\ settled = [m \in Messages |-> FALSE]
        /\ retry = [m \in Messages |-> FALSE]
        /\ stream = "idle"
        /\ stopped = FALSE
        /\ stamp = [m \in Messages |-> 0]
        /\ replyStamp = [m \in Messages |-> 0]
        /\ clock = 0
        /\ poll = "idle"
        /\ holder = "other"
        /\ waited = 0
        /\ attempts = 0
        /\ callbacks = 0
        /\ lastError = "none"
        /\ lookedUp = FALSE
        /\ lookupStamp = 0

Compose(m) == /\ active = MessageSession
              /\ composer = 0
              /\ ~entered[m]
              /\ composer' = m
              /\ UNCHANGED <<entered, queue, ord, nextOrd, active, inflight, inflightSession,
                             acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                             poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

Enqueue(m) == /\ composer = m
              /\ ~entered[m]
              /\ queue' = [queue EXCEPT ![MessageSession] = Append(@, m)]
              /\ entered' = [entered EXCEPT ![m] = TRUE]
              /\ ord' = [ord EXCEPT ![m] = nextOrd]
              /\ nextOrd' = nextOrd + 1
              /\ composer' = 0
              /\ UNCHANGED <<active, inflight, inflightSession, acked, settled, retry, stream, stopped,
                             stamp, replyStamp, clock, poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

SendQueued == /\ inflight = 0
              /\ queue[MessageSession] # <<>>
              /\ UNCHANGED <<composer, entered, ord, nextOrd, active, acked, settled, stamp, replyStamp, clock,
                             poll, holder, waited, attempts, callbacks, lastError>>
              /\ lookedUp' = FALSE
              /\ lookupStamp' = 0
              /\ LET m == Head(queue[MessageSession]) IN
                 /\ inflight' = m
                 /\ inflightSession' = MessageSession
                 /\ stream' = "open"
                 /\ stopped' = FALSE
                 /\ retry' = [retry EXCEPT ![m] = FALSE]
                 /\ queue' = queue

ReplyStored(m) == /\ inflight = m
                  /\ replyStamp[m] = 0
                  /\ replyStamp' = [replyStamp EXCEPT ![m] = clock + 1]
                  /\ clock' = clock + 1
                  /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                                 acked, settled, retry, stream, stopped, stamp,
                                 poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

LookupReply == /\ inflight # 0
               /\ ~acked[inflight]
               /\ ~lookedUp
               /\ lookedUp' = TRUE
               /\ lookupStamp' = replyStamp[inflight]
               /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                              acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                              poll, holder, waited, attempts, callbacks, lastError>>

Accept == /\ inflight # 0
          /\ lookedUp
          /\ ~acked[inflight]
          /\ LET m == inflight IN
             /\ stamp' = [stamp EXCEPT ![m] =
                  IF BackdateQueued /\ lookupStamp # 0
                  THEN lookupStamp - 1
                  ELSE clock + 1]
             /\ clock' = clock + 1
             /\ acked' = [acked EXCEPT ![m] = TRUE]
             /\ retry' = [retry EXCEPT ![m] = FALSE]
          /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                         settled, stream, stopped, replyStamp,
                         poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

Refuse == /\ inflight # 0
          /\ ~acked[inflight]
          /\ LET m == inflight IN
             /\ inflight' = 0
             /\ stream' = "idle"
             /\ retry' = [retry EXCEPT ![m] = TRUE]
          /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflightSession,
                         acked, settled, stopped, stamp, replyStamp, clock,
                         poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

ReplyEnd == /\ inflight # 0
            /\ acked[inflight]
            /\ LET m == inflight IN
               /\ settled' = [settled EXCEPT ![m] = TRUE]
               /\ queue' = HeldRemoved
               /\ inflight' = 0
               /\ stream' = "closed"
            /\ UNCHANGED <<composer, entered, ord, nextOrd, active, inflightSession,
                           acked, retry, stopped, stamp, replyStamp, clock,
                           poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

Stop == /\ inflight # 0
        /\ acked[inflight]
        /\ stopped' = TRUE
        /\ IF BugStopLeavesOpen
           THEN UNCHANGED <<inflight, stream, settled, queue>>
           ELSE LET m == inflight IN
                /\ settled' = [settled EXCEPT ![m] = TRUE]
                /\ queue' = HeldRemoved
                /\ inflight' = 0
                /\ stream' = "closed"
        /\ UNCHANGED <<composer, entered, ord, nextOrd, active, inflightSession,
                       acked, retry, stamp, replyStamp, clock,
                       poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

Switch(s) == /\ s \in Sessions
             /\ active # s
             /\ active' = s
             /\ IF BugSwitchClears
                THEN queue' = [t \in Sessions |-> <<>>]
                ELSE queue' = queue
             /\ UNCHANGED <<composer, entered, ord, nextOrd, inflight, inflightSession,
                            acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                            poll, holder, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

PollStart == /\ poll = "idle"
             /\ poll' = "waiting"
             /\ waited' = 0
             /\ attempts' = 1
             /\ lastError' = "none"
             /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                            acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                            holder, callbacks, lookedUp, lookupStamp>>

PollWait == /\ poll = "waiting"
            /\ holder = "other"
            /\ waited < MaxWait
            /\ waited' = waited + 1
            /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                           acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                           poll, holder, attempts, callbacks, lastError, lookedUp, lookupStamp>>

OtherReleases == /\ holder = "other"
                 /\ holder' = "none"
                 /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                                acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                                poll, waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

PollAcquire == /\ poll = "waiting"
               /\ holder = "none"
               /\ poll' = "reading"
               /\ holder' = "poll"
               /\ callbacks' = callbacks + 1
               /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                              acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                              waited, attempts, lastError, lookedUp, lookupStamp>>

PollCommit == /\ poll = "reading"
              /\ poll' = "done"
              /\ holder' = "none"
              /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                             acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                             waited, attempts, callbacks, lastError, lookedUp, lookupStamp>>

CallbackFail == /\ poll = "reading"
                /\ holder' = "none"
                /\ lastError' = "callback"
                /\ IF RetryPolicy = "always" /\ attempts = 1
                   THEN /\ poll' = "waiting"
                        /\ attempts' = 2
                        /\ waited' = 0
                   ELSE /\ poll' = "failed"
                        /\ UNCHANGED <<waited, attempts>>
                /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                               acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                               callbacks, lookedUp, lookupStamp>>

AcquisitionFail == /\ poll = "waiting"
                   /\ holder = "other"
                   /\ waited = MaxWait
                   /\ lastError' = "acquire"
                   /\ IF RetryPolicy # "none" /\ attempts = 1
                      THEN /\ poll' = "waiting"
                           /\ attempts' = 2
                           /\ waited' = 0
                      ELSE /\ poll' = "failed"
                           /\ UNCHANGED <<waited, attempts>>
                   /\ UNCHANGED <<composer, entered, queue, ord, nextOrd, active, inflight, inflightSession,
                                  acked, settled, retry, stream, stopped, stamp, replyStamp, clock,
                                  holder, callbacks, lookedUp, lookupStamp>>

Next == \/ \E m \in Messages : Compose(m)
        \/ \E m \in Messages : Enqueue(m)
        \/ SendQueued
        \/ \E m \in Messages : ReplyStored(m)
        \/ LookupReply
        \/ Accept
        \/ Refuse
        \/ ReplyEnd
        \/ Stop
        \/ \E s \in Sessions : Switch(s)
        \/ PollStart
        \/ PollWait
        \/ OtherReleases
        \/ PollAcquire
        \/ PollCommit
        \/ CallbackFail
        \/ AcquisitionFail

Spec == Init /\ [][Next]_vars

MessageConserved == \A m \in Messages : entered[m] => Present(m) = 1

DoneNotQueued == \A m \in Messages : settled[m] => ~InQueue(m)

FailedSendKeepsQueued == \A m \in Messages : retry[m] => InQueue(m)

ChatSwitchKeepsQueue == active # MessageSession =>
                          \A m \in Messages : entered[m] /\ ~settled[m] => InQueue(m) \/ inflight = m

QueueOrderKept == \A m \in Messages : settled[m] =>
                    \A n \in Messages : ord[n] # 0 /\ ord[n] < ord[m] => settled[n]

QueuedStoredBeforeReply == \A m \in Messages : stamp[m] # 0 =>
                             replyStamp[m] = 0 \/ stamp[m] < replyStamp[m]

StoppedReleasesSend == stopped => inflight = 0

StoppedStreamCloses == stopped => stream = "closed"

ReplyEndReleasesSend == \A m \in Messages : settled[m] => inflight # m

AcquisitionWindowKept == poll = "failed" /\ lastError = "acquire" => waited >= RequiredWait

AcquisitionRetried == lastError = "acquire" => attempts = 2

AcquisitionAttemptsBounded == attempts <= 2

AcquisitionNotReplayed == callbacks <= 1

=============================================================================
