import type { Command } from './types';

export class HistoryManager {
  private stack: Command[] = [];
  private pointer = -1;
  private onChange: () => void;

  constructor(onChange?: () => void) {
    this.onChange = onChange ?? (() => {});
  }

  setOnChange(fn: () => void) { this.onChange = fn; }

  push(cmd: Command) {
    this.stack = this.stack.slice(0, this.pointer + 1);
    cmd.execute();
    this.stack.push(cmd);
    this.pointer = this.stack.length - 1;
    this.onChange();
  }

  undo() {
    if (this.pointer < 0) return;
    this.stack[this.pointer].undo();
    this.pointer--;
    this.onChange();
  }

  redo() {
    if (this.pointer >= this.stack.length - 1) return;
    this.pointer++;
    this.stack[this.pointer].execute();
    this.onChange();
  }

  canUndo() { return this.pointer >= 0; }
  canRedo() { return this.pointer < this.stack.length - 1; }
  clear() { this.stack = []; this.pointer = -1; this.onChange(); }
}
