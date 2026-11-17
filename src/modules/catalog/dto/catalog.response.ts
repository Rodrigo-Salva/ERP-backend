import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/* Formas de las respuestas, solo para documentar la API en Swagger. */

export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  archivedAt!: Date | null;
}
export class UnitResponseDto extends CategoryResponseDto {
  @ApiProperty()
  code!: string;
  @ApiProperty({ minimum: 0, maximum: 3 })
  precision!: number;
}
export class ProductResponseDto extends CategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  variantId!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty()
  sku!: string;
  @ApiProperty({ type: String, nullable: true })
  barcode!: string | null;
  @ApiProperty({ format: 'uuid', type: String, nullable: true })
  categoryId!: string | null;
  @ApiProperty({ format: 'uuid' })
  unitId!: string;
  @ApiProperty({ type: String, example: '2.5000' })
  price!: string;
  @ApiPropertyOptional({
    type: String,
    description: 'Solo OWNER, ADMIN y MANAGER.',
  })
  cost?: string;
  @ApiProperty({ type: String, example: '5.000' })
  lowStockThreshold!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

class PageResponseDto {
  @ApiProperty()
  page!: number;
  @ApiProperty()
  limit!: number;
}
export class CategoriesPageDto extends PageResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  items!: CategoryResponseDto[];
}
export class UnitsPageDto extends PageResponseDto {
  @ApiProperty({ type: [UnitResponseDto] })
  items!: UnitResponseDto[];
}
export class ProductsPageDto extends PageResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];
}
