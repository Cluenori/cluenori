import { Fragment } from "react"

import type { TrailStep } from "@/router"
import { Link } from "@/router"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/views/ui/breadcrumb"

/**
 * Where a page is, from Now down, each level above it one click away; the page itself last, as
 * text. Nothing for none.
 */
export function PageTrail({ steps }: { readonly steps: ReadonlyArray<TrailStep> }) {
  if (steps.length === 0) {
    return null
  }
  return (
    <Breadcrumb aria-label="Where you are" className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-x-auto [scrollbar-width:none]">
        {steps.map((step, index) => (
          <Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="shrink-0">
              {step.to === undefined ? (
                <span aria-current="page" className="text-foreground">
                  {step.label}
                </span>
              ) : (
                <BreadcrumbLink render={<Link to={step.to} />}>{step.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
