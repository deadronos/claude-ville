import * as React from 'react';
import { clsx } from 'clsx';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeCva = cva('inline-flex items-center gap-1 font-pixel', {
  variants: {
    variant: {
      default: 'bg-surface text-text border border-border',
      working: 'bg-working/20 text-working border border-working/40',
      idle: 'bg-idle/20 text-idle border border-idle/40',
      waiting: 'bg-warning/20 text-warning border border-warning/40',
      accent: 'bg-accent/20 text-accent border border-accent/40',
    },
    size: {
      sm: 'h-5 px-1 text-xs',
      md: 'h-6 px-2 text-xs',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeCva> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={clsx(badgeCva({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';

export { Badge };
