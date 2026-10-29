// Content script of instagram.com: reads the posts on the screen only.
import { startCapture } from '../bb/content.common';
import {
  findInstagramPosts,
  getInstagramOwnHandle,
  instagramActionBar,
  parseInstagramPost,
} from './instagram.parser';

startCapture({
  platform: 'instagram',
  ownHandle: (doc) => getInstagramOwnHandle(doc),
  find: (doc) => {
    const own = getInstagramOwnHandle(doc);
    const posts = findInstagramPosts(doc);
    return posts.flatMap((container) => {
      // the address of the page only helps when it shows one post
      const item = parseInstagramPost(
        container,
        own,
        posts.length === 1 ? location.href : undefined
      );
      return item
        ? [{ item, container, bar: instagramActionBar(container) }]
        : [];
    });
  },
});
