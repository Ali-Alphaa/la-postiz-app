import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { InsightsActivity } from '@gitroom/orchestrator/activities/insights.activity';

const { generateWeeklyReviews, importOwnBestPosts } =
  proxyActivities<InsightsActivity>({
    startToCloseTimeout: '20 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

// Hourly: write the weekly review when the new week has none yet, and copy the
// organization's own best posts to the swipe file. Both skip what already exists.
export async function insightsWorkflow() {
  let loops = 0;
  while (true) {
    for (const job of [generateWeeklyReviews, importOwnBestPosts]) {
      try {
        await job();
      } catch (err) {}
    }

    await sleep('1 hour');

    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof insightsWorkflow>();
    }
  }
}
