import { computed, inject, Injectable, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Gif, RedditPost, RedditResponse } from '../interfaces';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  expand,
  map,
  of,
  startWith,
  Subject,
  switchMap,
} from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

export interface GifsState {
  gifs: Gif[];
  error: string | null;
  loading: boolean;
  lastKnowGif: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class RedditService {
  private http = inject(HttpClient);
  subredditFormControl = new FormControl();

  // state
  private state = signal<GifsState>({
    gifs: [],
    error: null,
    loading: true,
    lastKnowGif: null,
  });

  // selectors
  gifs = computed(() => this.state().gifs);
  error = computed(() => this.state().error);
  loading = computed(() => this.state().loading);
  lastKnowGif = computed(() => this.state().lastKnowGif);

  // sources
  pagination$ = new Subject<string | null>();
  subredditChanged$ = this.subredditFormControl.valueChanges.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    startWith('gifs'),
    map((subreddit) => (subreddit.length ? subreddit : 'gifs'))
  );
  private gifsLoaded$ = this.subredditChanged$.pipe(
    switchMap((subreddit) =>
      this.pagination$.pipe(
        startWith(undefined),
        concatMap((lastKnowGif) =>
          this.fetchFromReddit(subreddit, lastKnowGif!, 20).pipe(
            expand((response, index) => {
              const { gifs, gifsRequired, lastKnowGif } = response;
              const remainingGifsToFetch = gifsRequired - gifs.length;
              const maxAttempts = 15;

              const shouldKeepTrying =
                remainingGifsToFetch > 0 &&
                index < maxAttempts &&
                lastKnowGif !== null;

              return shouldKeepTrying
                ? this.fetchFromReddit(
                    subreddit,
                    lastKnowGif,
                    remainingGifsToFetch
                  )
                : EMPTY;
            })
          )
        )
      )
    )
  );
  private error$ = new Subject<string | null>();

  constructor() {
    // reducers
    this.subredditChanged$.pipe(takeUntilDestroyed()).subscribe(() =>
      this.state.update((state) => ({
        ...state,
        loading: true,
        gifs: [],
        lastKnowGif: null,
      }))
    );

    this.gifsLoaded$.pipe(takeUntilDestroyed()).subscribe((response) =>
      this.state.update((state) => ({
        ...state,
        gifs: [...state.gifs, ...response.gifs],
        loading: false,
        lastKnowGif: response.lastKnowGif,
      }))
    );

    this.error$.pipe(takeUntilDestroyed()).subscribe((error) =>
      this.state.update((state) => ({
        ...state,
        error,
      }))
    );
  }

  private fetchFromReddit(
    subreddit: string,
    after: string | null,
    gifsRequired: number
  ) {
    return this.http
      .get<RedditResponse>(
        `https://www.reddit.com/r/${subreddit}/hot/.json?limit=100` +
          (after ? `&after=${after}` : '')
      )
      .pipe(
        catchError((err) => {
          this.handleError(err);
          return EMPTY;
        }),
        map((response) => {
          const posts = response.data.children;
          const lastKnowGif = posts.length
            ? posts[posts.length - 1].data.name
            : null;

          return {
            gifs: this.convertRedditPostsToGifs(posts),
            gifsRequired,
            lastKnowGif,
          };
        })
      );
  }

  private convertRedditPostsToGifs(posts: RedditPost[]) {
    const defaultThumbnails = ['default', 'none', 'nsfw'];

    return posts
      .map((post) => {
        const thumbnail = post.data.thumbnail;
        const modifiedThumbnail = defaultThumbnails.includes(thumbnail)
          ? `/assets/${thumbnail}.png`
          : thumbnail;

        const validThumbnail =
          modifiedThumbnail.endsWith('.jpg') ||
          modifiedThumbnail.endsWith('.png');

        return {
          src: this.getBestSrcFromGif(post),
          author: post.data.author,
          name: post.data.name,
          permalink: post.data.permalink,
          title: post.data.title,
          thumbnail: validThumbnail ? modifiedThumbnail : `/assets/default.png`,
          comments: post.data.num_comments,
        };
      })
      .filter((post): post is Gif => post.src !== null);
  }

  private getBestSrcFromGif(post: RedditPost) {
    // If the source is in .mp4 format, leave unchanged
    if (post.data.url.indexOf('.mp4') > -1) {
      return post.data.url;
    }

    // If the source is in .gifv or .webm formats, convert to .mp4 and return
    if (post.data.url.indexOf('.gifv') > -1) {
      return post.data.url.replace('.gifv', '.mp4');
    }

    if (post.data.url.indexOf('.webm') > -1) {
      return post.data.url.replace('.webm', '.mp4');
    }

    // If the URL is not .gifv or .webm, check if media or secure media is available
    if (post.data.secure_media?.reddit_video) {
      return post.data.secure_media.reddit_video.fallback_url;
    }

    if (post.data.media?.reddit_video) {
      return post.data.media.reddit_video.fallback_url;
    }

    // If media objects are not available, check if a preview is available
    if (post.data.preview?.reddit_video_preview) {
      return post.data.preview.reddit_video_preview.fallback_url;
    }

    // No useable formats available
    return null;
  }

  private handleError(err: HttpErrorResponse) {
    // Handle specific error cases
    if (err.status === 404 && err.url) {
      this.error$.next(`Failed to load gifs for /r/${err.url.split('/')[4]}`);
      return;
    }

    // Generic error if no cases match
    this.error$.next(err.statusText);
  }
}
