export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { SwipeComponent } from '@gitroom/frontend/components/swipe/swipe.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Swipe File`,
  description: '',
};
export default async function Index() {
  return <SwipeComponent />;
}
