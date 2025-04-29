import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Component, inject } from '@angular/core';
import { InfiniteScrollDirective } from 'ngx-infinite-scroll';
import { RedditService } from '../shared/data-access/reddit.service';
import { GifListComponent } from './ui/gif-list/gif-list.component';
import { SearchBarComponent } from './ui/search-bar/search-bar.component';

@Component({
  selector: 'app-home',
  imports: [
    GifListComponent,
    InfiniteScrollDirective,
    SearchBarComponent,
    MatProgressSpinnerModule,
  ],
  template: `
    <app-search-bar
      [subredditFormControl]="redditService.subredditFormControl"
    ></app-search-bar>

    @if (redditService.loading()) {
    <mat-progress-spinner
      mode="indeterminate"
      diameter="50"
    ></mat-progress-spinner>
    } @else {
    <app-gif-list
      [gifs]="redditService.gifs()"
      infiniteScroll
      (scrolled)="redditService.pagination$.next(redditService.lastKnowGif())"
      class="grid-container"
    ></app-gif-list>
    }
  `,
  styles: [
    `
      mat-progress-spinner {
        margin: 2rem auto;
      }
    `,
  ],
})
export default class HomeComponent {
  redditService = inject(RedditService);
}
