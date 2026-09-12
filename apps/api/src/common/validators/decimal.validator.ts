import { Matches } from 'class-validator';

/**
 * Validates a non-negative monetary amount as a decimal STRING (e.g. "999.00"),
 * never a JS number - accepting a number here would let float imprecision
 * into a Prisma Decimal column the moment it's written. A plain regex (rather
 * than class-validator's IsDecimal) is used deliberately so the "no minus
 * sign" rule is explicit and guaranteed, not dependent on a library default.
 * Up to 10 integer digits, up to 2 decimal places.
 */
export function IsMoneyString() {
  return Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'must be a non-negative decimal string with up to 2 decimal places, e.g. "999.00"',
  });
}

/** Same rationale as IsMoneyString, but for weight (kg) which uses 3 decimal places. */
export function IsWeightString() {
  return Matches(/^\d{1,7}(\.\d{1,3})?$/, {
    message: 'must be a non-negative decimal string with up to 3 decimal places, e.g. "0.250"',
  });
}
