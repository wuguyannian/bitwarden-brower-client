import { ConstantsService } from 'jslib/services/constants.service';

import {
    LockService,
    StorageService,
} from 'jslib/abstractions';
import { NotificationsService } from 'jslib/abstractions/notifications.service';

const IdleInterval = 60 * 5; // 5 minutes

export default class IdleBackground {
    private idle: any;
    private idleTimer: number = null;
    private idleState = 'active';

    constructor(private lockService: LockService, private storageService: StorageService,
        private notificationsService: NotificationsService) {
        this.idle = chrome.idle || (browser != null ? browser.idle : null);
    }

    async init() {
        if (!this.idle) {
            return;
        }

        const idleHandler = (newState: string) => {
            if (newState === 'active') {
                this.notificationsService.reconnectFromActivity();
            } else {
                this.notificationsService.disconnectFromInactivity();
            }
        };
        if (this.idle.onStateChanged && this.idle.setDetectionInterval) {
            this.idle.setDetectionInterval(IdleInterval);
            this.idle.onStateChanged.addListener(idleHandler);
        } else {
            this.pollIdle(idleHandler);
        }

        if (this.idle.onStateChanged) {
            this.idle.onStateChanged.addListener(async (newState: string) => {
                if (newState === 'locked') {
                    const lockOption = await this.storageService.get<number>(ConstantsService.lockOptionKey);
                    if (lockOption === -2) {
                        this.lockService.lock(true);
                    }
                }
            });
        }
    }

    private pollIdle(handler: (newState: string) => void) {
        if (this.idleTimer != null) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idle.queryState(IdleInterval, (state: string) => {
            if (state !== this.idleState) {
                this.idleState = state;
                handler(state);
            }
            this.idleTimer = window.setTimeout(() => this.pollIdle(handler), 5000);
        });
    }
}
