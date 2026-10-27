import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { GrowthService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.service';
import { CompetitorsService } from '@gitroom/nestjs-libraries/database/prisma/growth/competitors.service';

@Injectable()
@Activity()
export class GrowthActivity {
  constructor(
    private _growthService: GrowthService,
    private _competitorsService: CompetitorsService
  ) {}

  @ActivityMethod()
  async collectEngagement() {
    return this._growthService.collectEngagement();
  }

  @ActivityMethod()
  async evaluateExperiments() {
    return this._growthService.evaluateExperiments();
  }

  @ActivityMethod()
  async recycleTopPosts() {
    return this._growthService.recycleTopPosts();
  }

  @ActivityMethod()
  async syncCompetitors() {
    return this._competitorsService.syncCompetitors();
  }
}
