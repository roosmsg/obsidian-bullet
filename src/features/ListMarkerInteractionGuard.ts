export class ListMarkerInteractionGuard {
  private dragStarted = false;

  beginPointerInteraction(): void {
    this.dragStarted = false;
  }

  markDragStarted(): void {
    this.dragStarted = true;
  }

  consumeDragClick(): boolean {
    const dragStarted = this.dragStarted;
    this.dragStarted = false;
    return dragStarted;
  }
}
