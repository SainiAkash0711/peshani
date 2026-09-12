import { Module } from '@nestjs/common';
import { AttributesService } from './attributes.service';
import { AttributesController } from './attributes.controller';
import { AttributeValuesService } from './attribute-values.service';
import { AttributeValuesController } from './attribute-values.controller';

@Module({
  controllers: [AttributesController, AttributeValuesController],
  providers: [AttributesService, AttributeValuesService],
  exports: [AttributesService, AttributeValuesService],
})
export class AttributesModule {}
