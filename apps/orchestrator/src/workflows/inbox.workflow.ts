import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';

const { syncInbox } = proxyActivities<InboxActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '1 minute',
  },
});

// Reads new comments and messages, which also answers the comment keywords
export async function inboxWorkflow() {
  let loops = 0;
  while (true) {
    try {
      await syncInbox();
    } catch (err) {}

    await sleep('5 minutes');

    if (++loops >= 200 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof inboxWorkflow>();
    }
  }
}
