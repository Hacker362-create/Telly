import { TELLY_CODECS, getCodecStats } from '../src/media/Codecs';

describe('TELLY_CODECS', () => {
  it('should define exactly one audio codec', () => {
    expect(TELLY_CODECS).toHaveLength(1);
    expect(TELLY_CODECS[0].kind).toBe('audio');
    expect(TELLY_CODECS[0].mimeType).toBe('audio/opus');
  });

  it('should enable DTX (Discontinuous Transmission)', () => {
    expect(TELLY_CODECS[0].parameters?.usedtx).toBe(1);
  });

  it('should enable in-band FEC for robustness on weak networks', () => {
    expect(TELLY_CODECS[0].parameters?.useinbandfec).toBe(1);
  });

  it('should cap bitrate at 16kbps for data savings', () => {
    expect(TELLY_CODECS[0].parameters?.maxaveragebitrate).toBe(16000);
  });

  it('should use maximum compression complexity', () => {
    expect(TELLY_CODECS[0].parameters?.complexity).toBe(10);
  });
});

describe('getCodecStats', () => {
  it('should return correct stats', () => {
    const stats = getCodecStats();
    expect(stats.dtxEnabled).toBe(true);
    expect(stats.fecEnabled).toBe(true);
    expect(stats.bitrate).toBe(16000);
    expect(stats.mimeType).toBe('audio/opus');
  });
});
