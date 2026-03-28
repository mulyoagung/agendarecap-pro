"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"
// Import standard V9 stylesheet so the grid never breaks
import "react-day-picker/style.css"

// Override react-day-picker styles globally for our dark theme
import "./calendar.css"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <div className={cn("p-6 glass rounded-3xl shrink-0 border border-white/5", className)}>
      <DayPicker
        showOutsideDays={showOutsideDays}
        className="w-full flex justify-center custom-calendar"
        components={{
          Chevron: (props) => {
            if (props.orientation === 'left') return <ChevronLeft className="w-4 h-4" />;
            if (props.orientation === 'right') return <ChevronRight className="w-4 h-4" />;
            return <ChevronRight className="w-4 h-4" />;
          }
        }}
        {...props}
      />
    </div>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
