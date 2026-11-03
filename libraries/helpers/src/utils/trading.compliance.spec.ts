import { checkTradingCompliance } from './trading.compliance';

describe('checkTradingCompliance', () => {
  it.each([
    'This setup has guaranteed profits every month',
    'Our returns are guaranteed',
    'A risk-free way to trade gold',
    'You cannot lose with this system',
    'Get rich trading options',
    'My strategy has a 95% win rate',
  ])('flags as high: %s', (text) => {
    expect(
      checkTradingCompliance(text).some((p) => p.severity === 'high')
    ).toBe(true);
  });

  it('flags results without risk wording, not with it', () => {
    expect(checkTradingCompliance('I made $5000 this week')).toHaveLength(1);
    expect(
      checkTradingCompliance(
        'I made $5000 this week. Trading carries risk of losses.'
      )
    ).toHaveLength(0);
  });

  it.each([
    'Risk management is the whole game',
    'Get the $5 ebook on candlesticks',
    'Most traders have a patience problem',
    'The edge shows up after the 30th trade',
    'Nothing is guaranteed in trading',
  ])('leaves alone: %s', (text) => {
    expect(checkTradingCompliance(text)).toHaveLength(0);
  });

  it('reads post html', () => {
    expect(
      checkTradingCompliance('<p>risk&nbsp;free</p>').length
    ).toBeGreaterThan(0);
  });
});
