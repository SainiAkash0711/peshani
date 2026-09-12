import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface VariantAxis {
  attributeId: string;
  valueIds: string[];
}

export interface GeneratedCombination {
  /** One attribute-value id per axis, in the order the axes were given (for display). */
  attributeValueIds: string[];
  /**
   * Deterministic, order-independent uniqueness key: the same set of value
   * ids always produces the same key regardless of which order the axes (or
   * the values within them) were supplied in - "Color=Black,Size=M" and
   * "Size=M,Color=Black" both normalize to this same string. Value ids are
   * globally-unique UUIDs already scoped to exactly one attribute, so sorting
   * the bare id list is sufficient to prevent collisions; no attribute-id
   * prefix is needed in the key itself.
   */
  combinationKey: string;
}

@Injectable()
export class VariantGeneratorService {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  buildCombinationKey(attributeValueIds: string[]): string {
    return [...attributeValueIds].sort().join('-');
  }

  countCombinations(axes: VariantAxis[]): number {
    return axes.reduce((total, axis) => total * new Set(axis.valueIds).size, 1);
  }

  getMaxCombinations(): number {
    return this.configService.get('catalog', { infer: true }).maxVariantCombinations;
  }

  /**
   * Cartesian product of every axis's values. Validates non-empty axes and
   * enforces the configurable combination-count ceiling before doing any
   * multiplication work, so a malformed or malicious request can't make the
   * server spend time building millions of combinations before rejecting it.
   */
  generate(axes: VariantAxis[]): GeneratedCombination[] {
    if (axes.length === 0) {
      throw new BadRequestException('At least one attribute axis is required to generate variants');
    }

    const dedupedAxes = axes.map((axis) => ({
      attributeId: axis.attributeId,
      valueIds: Array.from(new Set(axis.valueIds)),
    }));

    for (const axis of dedupedAxes) {
      if (axis.valueIds.length === 0) {
        throw new BadRequestException(`Attribute ${axis.attributeId} has no selected values`);
      }
    }

    const total = this.countCombinations(dedupedAxes);
    const max = this.getMaxCombinations();
    if (total > max) {
      throw new BadRequestException(
        `Requested combination count (${total}) exceeds the maximum allowed (${max}). Narrow your attribute selections or raise MAX_VARIANT_COMBINATIONS.`,
      );
    }

    let combinations: string[][] = [[]];
    for (const axis of dedupedAxes) {
      const next: string[][] = [];
      for (const partial of combinations) {
        for (const valueId of axis.valueIds) {
          next.push([...partial, valueId]);
        }
      }
      combinations = next;
    }

    return combinations.map((attributeValueIds) => ({
      attributeValueIds,
      combinationKey: this.buildCombinationKey(attributeValueIds),
    }));
  }
}
