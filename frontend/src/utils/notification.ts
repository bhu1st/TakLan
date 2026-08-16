import { playMessageSound } from './audio';

/**
 * Triggers audio chime notification for 1-1 private messages.
 */
export function playPrivateMessageAlert() {
  playMessageSound();
}
