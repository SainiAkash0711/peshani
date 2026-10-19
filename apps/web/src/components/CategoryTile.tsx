import Link from 'next/link';
import Image from 'next/image';
import { isAllowedImageUrl } from '../lib/safe-image';

const TONES = 6;

interface CategoryTileProps {
  slug: string;
  name: string;
  image: string | null;
  description?: string | null;
  subcategoryCount?: number;
  index: number;
}

export function CategoryTile({ slug, name, image, description, subcategoryCount, index }: CategoryTileProps) {
  const hasImage = image && isAllowedImageUrl(image);
  return (
    <Link href={`/categories/${slug}`} className="cat-tile">
      <span className={`cat-tile__media cat-tile__media--${index % TONES}`}>
        {hasImage ? (
          <Image src={image} alt="" fill sizes="(max-width: 640px) 45vw, 200px" />
        ) : (
          <span className="cat-tile__initial" aria-hidden="true">
            {name.charAt(0)}
          </span>
        )}
      </span>
      <span className="cat-tile__body">
        <span className="cat-tile__name">{name}</span>
        {subcategoryCount !== undefined && subcategoryCount > 0 ? (
          <span className="cat-tile__meta">
            {subcategoryCount} {subcategoryCount === 1 ? 'collection' : 'collections'}
          </span>
        ) : (
          description && <span className="cat-tile__meta">{description}</span>
        )}
        <span className="cat-tile__cta">
          Shop now <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}
