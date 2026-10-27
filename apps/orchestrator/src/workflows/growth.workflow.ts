import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { GrowthActivity } from '@gitroom/orchestrator/activities/growth.activity';

const {
  collectEngagement,
  evaluateExperiments,
  recycleTopPosts,
  syncCompetitors,
} = proxyActivities<GrowthActivity>({
  startToCloseTimeout: '20 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Hourly growth jobs: store the engagement of the published posts, pick the
// A/B tests winners (they need fresh engagement), schedule the evergreen
// recycles and refresh the tracked competitors (each one once a day).
// A failing job never stops the others or the loop.
export async function growthWorkflow() {
  let loops = 0;
  while (true) {
    for (const job of [
      collectEngagement,
      evaluateExperiments,
      recycleTopPosts,
      syncCompetitors,
    ]) {
      try {
        await job();
      } catch (err) {}
    }

    await sleep('1 hour');

    // Keep the history small, the new run starts with the jobs so the hourly cadence is kept
    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof growthWorkflow>();
    }
  }
}
