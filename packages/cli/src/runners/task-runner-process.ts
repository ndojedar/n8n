import { GlobalConfig } from '@n8n/config';
import * as a from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Service } from 'typedi';

import { TaskRunnerAuthService } from './auth/task-runner-auth.service';
import { OnShutdown } from '../decorators/on-shutdown';

type ChildProcess = ReturnType<typeof spawn>;

/**
 * Manages the JS task runner process as a child process
 */
@Service()
export class TaskRunnerProcess {
	public get isRunning() {
		return this.process !== null;
	}

	/** The process ID of the task runner process */
	public get pid() {
		return this.process?.pid;
	}

	private process: ChildProcess | null = null;

	/** Promise that resolves after the process has exited */
	private runPromise: Promise<void> | null = null;

	private isShuttingDown = false;

	constructor(
		private readonly globalConfig: GlobalConfig,
		private readonly authService: TaskRunnerAuthService,
	) {}

	async start() {
		a.ok(!this.process, 'Task Runner Process already running');

		const grantToken = await this.authService.createGrantToken();

		const n8nUri = `127.0.0.1:${this.globalConfig.taskRunners.port}`;
		this.process = this.globalConfig.taskRunners.useLauncher
			? this.startLauncher(grantToken, n8nUri)
			: this.startNode(grantToken, n8nUri);

		this.process.stdout?.pipe(process.stdout);
		this.process.stderr?.pipe(process.stderr);

		this.monitorProcess(this.process);
	}

	startNode(grantToken: string, n8nUri: string) {
		const startScript = require.resolve('@n8n/task-runner');

		return spawn('node', [startScript], {
			env: {
				PATH: process.env.PATH,
				N8N_RUNNERS_GRANT_TOKEN: grantToken,
				N8N_RUNNERS_N8N_URI: n8nUri,
			},
		});
	}

	startLauncher(grantToken: string, n8nUri: string) {
		return spawn(
			this.globalConfig.taskRunners.launcherPath,
			['launch', this.globalConfig.taskRunners.launcherRunner],
			{
				env: {
					PATH: process.env.PATH,
					N8N_RUNNERS_GRANT_TOKEN: grantToken,
					N8N_RUNNERS_N8N_URI: n8nUri,
					// For debug logging if enabled
					RUST_LOG: process.env.RUST_LOG,
				},
			},
		);
	}

	@OnShutdown()
	async stop() {
		if (!this.process) {
			return;
		}

		this.isShuttingDown = true;

		// TODO: Timeout & force kill
		if (this.globalConfig.taskRunners.useLauncher) {
			await this.killLauncher();
		} else {
			this.killNode();
		}
		await this.runPromise;

		this.isShuttingDown = false;
	}

	killNode() {
		if (!this.process) {
			return;
		}
		this.process.kill();
	}

	async killLauncher() {
		if (!this.process?.pid) {
			return;
		}

		const process = spawn(this.globalConfig.taskRunners.launcherPath, [
			'kill',
			'javascript',
			this.process.pid.toString(),
		]);

		await new Promise<void>((resolve) => {
			process.on('exit', () => {
				resolve();
			});
		});
	}

	private monitorProcess(process: ChildProcess) {
		this.runPromise = new Promise((resolve) => {
			process.on('exit', (code) => {
				this.onProcessExit(code, resolve);
			});
		});
	}

	private onProcessExit(_code: number | null, resolveFn: () => void) {
		this.process = null;
		resolveFn();

		// If we are not shutting down, restart the process
		if (!this.isShuttingDown) {
			setImmediate(async () => await this.start());
		}
	}
}
