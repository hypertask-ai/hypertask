import { readFileSync } from 'node:fs';
import { taskIncident } from './incident.mjs';
import { findRelatedIncident } from './collector.mjs';

try {
  const value = JSON.parse(readFileSync(0, 'utf8'));
  const task = value.success === true && value.tasks?.[0];
  if (!task) throw new Error('missing ticket');
  if (task.labels?.some(label => ['Error Log', 'prod-error', 'ai-feedback'].includes(label.name))) {
    const incident = taskIncident(task);
    if (incident) {
      const found = findRelatedIncident({ board: 15, incident, firstSeen: incident.ts, claim: task }, process.env);
      if (found && found.ticket !== task.ticketNumber) {
        console.log(`ship-claim: STEP BACK; related open incident https://app.hypertask.ai/detail/project-15/${found.ticket.split('-')[1]}; coordinate there before claiming another alert`);
        process.exitCode = 3;
      }
    }
  }
} catch {
  console.error('ship-claim: related incident check failed; no claim written');
  process.exitCode = 2;
}
