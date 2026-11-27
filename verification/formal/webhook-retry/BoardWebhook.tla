--------------------------- MODULE BoardWebhook ----------------------------
EXTENDS Naturals, TLC

CONSTANTS Workers, MaxAttempts, MaxPosts, ClaimTakesProcessing,
          SuccessNeedsFence

ASSUME /\ Workers # {}
       /\ MaxAttempts \in Nat
       /\ MaxAttempts >= 1
       /\ MaxPosts \in Nat
       /\ MaxPosts > MaxAttempts

VARIABLES status, attempts, holder, stale, phase, lastOk, posts, succeeded

vars == <<status, attempts, holder, stale, phase, lastOk, posts, succeeded>>

Init == /\ status = "pending"
        /\ attempts = 0
        /\ holder = 0
        /\ stale = FALSE
        /\ phase = [w \in Workers |-> "idle"]
        /\ lastOk = [w \in Workers |-> FALSE]
        /\ posts = 0
        /\ succeeded = FALSE

claimable == \/ status \in {"pending", "retrying"}
             \/ /\ ClaimTakesProcessing
                /\ status = "processing"
                /\ stale

Claim(w) == /\ phase[w] \in {"idle", "done"}
            /\ attempts < MaxAttempts
            /\ claimable
            /\ status' = "processing"
            /\ holder' = w
            /\ stale' = FALSE
            /\ phase' = [phase EXCEPT ![w] = "post"]
            /\ UNCHANGED <<attempts, lastOk, posts, succeeded>>

PostOk(w) == LET fenced == /\ status = "processing"
                           /\ holder = w
                           /\ ~stale
             IN /\ phase[w] = "post"
                /\ posts < MaxPosts
                /\ posts' = posts + 1
                /\ lastOk' = [lastOk EXCEPT ![w] = TRUE]
                /\ succeeded' = TRUE
                /\ phase' = [phase EXCEPT ![w] = "idle"]
                /\ \/ /\ fenced
                      /\ status' = "delivered"
                      /\ attempts' = attempts + 1
                      /\ holder' = 0
                      /\ stale' = FALSE
                   \/ /\ ~fenced
                      /\ ~SuccessNeedsFence
                      /\ status' = "delivered"
                      /\ attempts' = attempts
                      /\ holder' = 0
                      /\ stale' = FALSE
                   \/ /\ ~fenced
                      /\ SuccessNeedsFence
                      /\ status' = status
                      /\ attempts' = attempts
                      /\ holder' = holder
                      /\ stale' = stale

PostFail(w) == /\ phase[w] = "post"
               /\ posts < MaxPosts
               /\ posts' = posts + 1
               /\ lastOk' = [lastOk EXCEPT ![w] = FALSE]
               /\ phase' = [phase EXCEPT ![w] = "record"]
               /\ UNCHANGED <<status, attempts, holder, stale, succeeded>>

PostPastBound(w) == /\ phase[w] = "post"
                    /\ posts >= MaxPosts
                    /\ phase' = [phase EXCEPT ![w] = "done"]
                    /\ UNCHANGED <<status, attempts, holder, stale, lastOk, posts, succeeded>>

Record(w) == /\ phase[w] = "record"
             /\ status = "processing"
             /\ holder = w
             /\ ~stale
             /\ attempts' = attempts + 1
             /\ status' = IF attempts + 1 >= MaxAttempts THEN "failed" ELSE "retrying"
             /\ holder' = 0
             /\ stale' = FALSE
             /\ phase' = [phase EXCEPT ![w] = "idle"]
             /\ UNCHANGED <<lastOk, posts, succeeded>>

FenceMiss(w) == /\ phase[w] = "record"
                /\ ~(status = "processing" /\ holder = w /\ ~stale)
                /\ phase' = [phase EXCEPT ![w] = "idle"]
                /\ UNCHANGED <<status, attempts, holder, stale, lastOk, posts, succeeded>>

LeaseStale(w) == /\ holder = w
                 /\ ~stale
                 /\ stale' = TRUE
                 /\ UNCHANGED <<status, attempts, holder, phase, lastOk, posts, succeeded>>

Sweep == /\ status = "processing"
         /\ stale
         /\ status' = "retrying"
         /\ holder' = 0
         /\ stale' = FALSE
         /\ attempts' = attempts + 1
         /\ UNCHANGED <<phase, lastOk, posts, succeeded>>

Exhaust == /\ status = "retrying"
           /\ attempts >= MaxAttempts
           /\ status' = "failed"
           /\ UNCHANGED <<attempts, holder, stale, phase, lastOk, posts, succeeded>>

Finished == /\ status \in {"delivered", "failed"}
            /\ \A w \in Workers : phase[w] \in {"idle", "done"}
            /\ UNCHANGED vars

Next == \E w \in Workers :
          \/ Claim(w) \/ PostOk(w) \/ PostFail(w) \/ PostPastBound(w) \/ Record(w) \/ FenceMiss(w) \/ LeaseStale(w)
        \/ Sweep \/ Exhaust \/ Finished

Spec == Init /\ [][Next]_vars

AttemptsBound == attempts <= MaxAttempts

PostsWithinCap == posts <= MaxAttempts

SuccessNotReportedFailed == succeeded => status # "failed"

=============================================================================
