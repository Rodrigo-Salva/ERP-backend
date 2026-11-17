import { Prisma } from '../../../generated/prisma/client';
export const round = (value: Prisma.Decimal, precision: number) =>
  value.toDecimalPlaces(precision, Prisma.Decimal.ROUND_HALF_UP);
export function lineTotals(
  price: Prisma.Decimal,
  quantity: Prisma.Decimal,
  discountRate: Prisma.Decimal,
  taxRate: Prisma.Decimal,
  included: boolean,
  precision: number,
) {
  const gross = round(price.mul(quantity), precision);
  const discount = round(gross.mul(discountRate).div(100), precision);
  const net = gross.minus(discount);
  const tax = round(
    included
      ? net.minus(net.div(new Prisma.Decimal(1).plus(taxRate.div(100))))
      : net.mul(taxRate).div(100),
    precision,
  );
  return { gross, discount, tax, total: included ? net : net.plus(tax) };
}
export function returnPart(
  total: Prisma.Decimal,
  quantity: Prisma.Decimal,
  already: Prisma.Decimal,
  returned: Prisma.Decimal,
  precision: number,
) {
  return round(
    total.mul(already.plus(returned)).div(quantity),
    precision,
  ).minus(round(total.mul(already).div(quantity), precision));
}
