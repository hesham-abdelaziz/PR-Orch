/** Another review is already queued or running. Mapped to HTTP 409. */
export class ActiveReviewExistsError extends Error {
  constructor(readonly activeJobId: string) {
    super('Another review is already in progress.');
    this.name = 'ActiveReviewExistsError';
  }
}

/** No review with the given id exists. Mapped to HTTP 404. */
export class ReviewNotFoundError extends Error {
  constructor(readonly reviewId: string) {
    super('Review not found.');
    this.name = 'ReviewNotFoundError';
  }
}
