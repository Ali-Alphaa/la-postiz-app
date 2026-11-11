export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MusicComponent } from '@gitroom/frontend/components/music/music.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Music`,
  description: '',
};
export default async function Index() {
  return <MusicComponent />;
}
