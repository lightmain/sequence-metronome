import type { Page } from '@playwright/test';

// CI 没有真实扬声器：只模拟输出设备。文件请求和 WAV 解码仍由浏览器实际执行。
export async function installAudioOutput(page: Page) {
  // 本机受控浏览器的媒体请求可能返回空响应；由 Playwright 请求实际服务器文件再交给浏览器解码。
  await page.route('**/sounds/click.wav', async (route) => {
    await route.fulfill({ response: await page.request.get(route.request().url()) });
  });
  await page.addInitScript(() => {
    class TestAudioOutput {
      state = 'suspended';
      sampleRate = 44100;
      destination = {};
      outputLatency = 0;
      origin = performance.now();
      get currentTime() {
        return (performance.now() - this.origin) / 1000;
      }
      async resume() {
        this.state = 'running';
      }
      async close() {
        this.state = 'closed';
      }
      async decodeAudioData(buffer: ArrayBuffer) {
        return new OfflineAudioContext(1, 1, 44100).decodeAudioData(buffer);
      }
      createGain() {
        return { gain: { value: 1, setTargetAtTime() {} }, connect() {}, disconnect() {} };
      }
      createBufferSource() {
        const currentTime = () => this.currentTime;
        let timer: ReturnType<typeof setTimeout> | undefined;
        return {
          buffer: null as AudioBuffer | null,
          playbackRate: { value: 1 },
          onended: null as (() => void) | null,
          connect() {},
          disconnect() {},
          start(time: number) {
            timer = setTimeout(
              () => this.onended?.(),
              Math.max(0, time - currentTime()) * 1000 + 100,
            );
          },
          stop() {
            clearTimeout(timer);
            this.onended?.();
          },
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: TestAudioOutput, configurable: true });
  });
}
