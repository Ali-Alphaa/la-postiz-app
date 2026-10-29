// Content script of tiktok.com: reads the videos on the screen only.
import { startCapture } from '../bb/content.common';
import {
  findTikTokVideos,
  getTikTokOwnHandle,
  parseTikTokVideo,
  tiktokActionBar,
} from './tiktok.parser';

startCapture({
  platform: 'tiktok',
  ownHandle: (doc) => getTikTokOwnHandle(doc),
  find: (doc) => {
    const own = getTikTokOwnHandle(doc);
    const videos = findTikTokVideos(doc);
    return videos.flatMap((container) => {
      // the address of the page only helps when it shows one video
      const item = parseTikTokVideo(
        container,
        own,
        videos.length === 1 ? location.href : undefined
      );
      return item ? [{ item, container, bar: tiktokActionBar(container) }] : [];
    });
  },
});
