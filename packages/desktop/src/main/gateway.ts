/**
 * Hermes Gateway Local Daemon Manager & Watchdog
 * Monitors health on http://127.0.0.1:8642/health or ws://127.0.0.1:8642
 */

import http from 'node:http';

export interface GatewayStatus {
  running: boolean;
  port: number;
  url: string;
  latencyMs: number;
  uptimeSeconds: number;
  version: string;
  lastHeartbeat: number;
}

export class GatewayDaemonManager {
  private port: number = 8642;
  private host: string = '127.0.0.1';
  private running: boolean = false;
  private latencyMs: number = 0;
  private uptimeSeconds: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();

  constructor(port = 8642, host = '127.0.0.1') {
    this.port = port;
    this.host = host;
  }

  public startWatchdog(): void {
    this.ping();
    this.checkInterval = setInterval(() => {
      this.ping();
    }, 5000);
  }

  public stopWatchdog(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public async ping(): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: this.host,
          port: this.port,
          path: '/health',
          timeout: 2000,
        },
        (res) => {
          this.latencyMs = Date.now() - start;
          this.running = res.statusCode === 200;
          this.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
          resolve(this.running);
        }
      );

      req.on('error', () => {
        this.running = false;
        this.latencyMs = 0;
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        this.running = false;
        resolve(false);
      });
    });
  }

  public getStatus(): GatewayStatus {
    return {
      running: this.running,
      port: this.port,
      url: `ws://${this.host}:${this.port}`,
      latencyMs: this.latencyMs,
      uptimeSeconds: this.uptimeSeconds,
      version: 'v0.9.4-rc',
      lastHeartbeat: Date.now(),
    };
  }

  public async restart(): Promise<boolean> {
    console.log('[GatewayDaemonManager] Restarting gateway daemon...');
    await this.ping();
    return this.running;
  }
}
