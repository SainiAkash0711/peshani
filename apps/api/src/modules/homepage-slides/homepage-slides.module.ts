import { Module } from '@nestjs/common';
import { HomepageSlidesService } from './homepage-slides.service';
import { HomepageSlidesController } from './homepage-slides.controller';

@Module({
  controllers: [HomepageSlidesController],
  providers: [HomepageSlidesService],
  exports: [HomepageSlidesService],
})
export class HomepageSlidesModule {}
