// The toolbar badge: the posts waiting for X's scheduler come first (orange),
// otherwise the tweets saved to the library today (purple)
export const PENDING_COLOR = '#F97316';
export const SAVED_COLOR = '#612BD3';

export const badgeFor = (state: { pending: number; savedToday: number }) => {
  if (state.pending > 0) {
    return {
      text: state.pending > 99 ? '99+' : String(state.pending),
      color: PENDING_COLOR,
    };
  }
  if (state.savedToday > 0) {
    return { text: String(state.savedToday), color: SAVED_COLOR };
  }
  return { text: '', color: SAVED_COLOR };
};
