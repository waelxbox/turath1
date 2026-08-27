# Visual Archives Automated Intake

## Intake contract

Each successful JPEG or PNG upload now creates exactly one VRA **Image** record, attached to the uploaded private asset and placed in `needs_review`. Once immutable storage and display derivatives are ready, TURATH sends the display derivative to Gemini 3.1 Pro and stores the resulting suggestions and provenance separately from human-reviewed metadata.

If the model request is temporarily unavailable, the upload remains successful and its Image record remains in the review queue. The reviewer can open the record and use **Suggest fields** to retry; no automatic metadata approval occurs in either case.

## Batch behavior

The Visual Assets page accepts multiple files. It processes at most two image-plus-Gemini intake operations concurrently to avoid a burst of premium-model requests, displays `Processing X/Y`, reports failures without abandoning the rest of the selection, and invalidates the assets, records, and statistics views on completion. The page instructs the user to leave the page open while the batch completes.

## Live verification

The owner-authorized synthetic batch smoke test created two PNG assets concurrently in project 141. Both reached ready status, each produced exactly one Image record with a separate non-empty AI suggestion payload, neither changed reviewed metadata, and the visual review queue reported two records awaiting review.

The authenticated browser check confirmed that project 141 shows two newly created Image records in its review queue. Opening one record showed the private derivative, an empty human-reviewed form, a separate suggested title, a clearly labelled candidate identification, and independently acceptible AI fields. No suggestion had been applied automatically.
