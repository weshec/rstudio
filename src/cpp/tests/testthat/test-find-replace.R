#
# test-find-replace.R
#
# Copyright (C) 2009-18 by RStudio, Inc.
#
# Unless you have received this program directly from RStudio pursuant
# to the terms of a commercial license agreement with RStudio, then
# this program is licensed to you under the terms of version 3 of the
# GNU Affero General Public License. This program is distributed WITHOUT
# ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
# MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
# AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
#
#

context("find-replace")

test_that("complete replace", {
   # declare variables
   find <- "tidyverse"
   asRegex <- FALSE
   ignoreCase <- FALSE
   directory <- file.path(getwd(), "find-replace")
   includeFilePatterns <- list("")
   excludeFilePatterns <- list("")
   originalFindCount <- 1L
   replace <- "spideyverse"


   # sleep before pausing events so other events can clear
   Sys.sleep(5)
   .rs.pauseClientEventErase()
   result <- .rs.invokeRpc("complete_replace", find,
                           asRegex, ignoreCase,
                           directory, includeFilePatterns, excludeFilePatterns,
                           originalFindCount, replace)

   # search for replace_result event
   events <- .rs.getClientEvents();
   foundResult = FALSE
   timeoutCounter = 0
   while (!foundResult && timeoutCounter < 20)
   {
      for (i in events)
      {
         if (i$type == "replace_result")
         {
            foundResult = TRUE
            #print(i$data)
            expect_equal(i$data$results$file[[1]],
                         "~/work/rstudio/src/cpp/tests/testthat/find-replace/a.txt")
            expect_equal(i$data$results$line[[1]], 1)
            expect_equal(i$data$results$matchOn[[1]][[1]], 0)
            expect_equal(i$data$results$matchOff[[1]][[1]], 9)
         }
      }
      if (!foundResult)
      {
         timeoutCounter = timeoutCounter + 5
         Sys.sleep(timeoutCounter)
         events <- .rs.getClientEvents();
      }
   }

   # leave environment as we found it
   .rs.continueClientEventErase()
   write("tidyverse", file = "find-replace/a.txt")

   expect_true(foundResult)
})
