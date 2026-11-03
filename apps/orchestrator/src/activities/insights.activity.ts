import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { GrowthToolsService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.service';
import { SwipeService } from '@gitroom/nestjs-libraries/database/prisma/swipe/swipe.service';

@Injectable()
@Activity()
export class InsightsActivity {
  constructor(
    private _growthToolsService: GrowthToolsService,
    private _swipeService: SwipeService
  ) {}

  @ActivityMethod()
  async generateWeeklyReviews() {
    return this._growthToolsService.generateDueReviews();
  }

  @ActivityMethod()
  async importOwnBestPosts() {
    return this._swipeService.importOwnBestPostsForAll();
  }
}
