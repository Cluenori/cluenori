import {
  ActivityIcon,
  ArrowUpIcon,
  BugIcon,
  CircleDashedIcon,
  DownloadIcon,
  FileCodeIcon,
  FileTextIcon,
  MessageCircleIcon,
  PaperclipIcon,
  ScrollTextIcon,
  SparklesIcon,
  TagIcon,
  TerminalIcon,
  ThumbsUpIcon,
} from "lucide-react"

import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { clockTime, count, duration } from "@/lib/format"
import { KitCard, KitGroup, KitSample } from "@/pages/kit-section"
import { Link } from "@/router"
import { errorStacks, incident, sampleNow, sampleProject, sampleTrace } from "@/sample/sample-project"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/views/ui/attachment"
import { Bubble, BubbleContent, BubbleReactions } from "@/views/ui/bubble"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/views/ui/code-block"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/views/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@/views/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/views/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/views/ui/message-scroller"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/views/ui/questionnaire"
import { toast } from "@/views/ui/toast"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/views/ui/trace"

const minute = 60_000

const askedAt = sampleNow - 8 * minute
const releasedAt = incident.from - 4 * minute

const testTrace = `curl -X POST "$CLUENORI_URL/otlp/v1/traces" \\
  -H "Authorization: Bearer $CLUENORI_INGEST_KEY" \\
  -H "Content-Type: application/json" \\
  --data @test-trace.json`

const stackHead = (errorStacks["4f1c9a2e7b3d5068"] ?? "").split("\n").slice(0, 4).join("\n")

const bubbleVariants = ["default", "secondary", "muted", "tinted", "outline", "ghost", "destructive"] as const

function TestTraceBlock() {
  const lines = useHighlightedCode(testTrace, "bash")
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <TerminalIcon />
          Send a test trace
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={testTrace} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function WhatWasChecked() {
  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>Checked 5 things</TraceTitle>
            <TraceDescription>in {duration(6_200)}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            <TraceLine>
              <TraceIcon>
                <ActivityIcon />
              </TraceIcon>
              <TraceTitle>POST /api/export this morning</TraceTitle>
              <TraceDescription>{count(1_204)}</TraceDescription>
            </TraceLine>
            <TraceLine status="error">
              <TraceIcon>
                <BugIcon />
              </TraceIcon>
              <TraceTitle>{count(39)} of them failed with NpgsqlException</TraceTitle>
              <TraceDescription>
                {clockTime(incident.from)} to {clockTime(incident.to)}
              </TraceDescription>
            </TraceLine>
            <TraceLine>
              <TraceIcon>
                <ScrollTextIcon />
              </TraceIcon>
              <TraceTitle>The logs of folio-api around then</TraceTitle>
              <TraceDescription>{count(212)} lines</TraceDescription>
            </TraceLine>
            <TraceLine>
              <TraceIcon>
                <TagIcon />
              </TraceIcon>
              <TraceTitle>Release 2.14.0+412 of folio-api</TraceTitle>
              <TraceDescription>shipped at {clockTime(releasedAt)}</TraceDescription>
            </TraceLine>
            <TraceLine status="pending">
              <TraceIcon>
                <CircleDashedIcon />
              </TraceIcon>
              <TraceTitle>The database's own numbers</TraceTitle>
              <TraceDescription>not sent to Cluenori</TraceDescription>
            </TraceLine>
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function NextStep() {
  return (
    <Questionnaire
      shortcuts="numbers"
      onSubmit={(event) => {
        event.preventDefault()
        toast.add({ type: "success", title: "Sent to Cluenori", description: "It will start on the fix." })
      }}
      className="rounded-xl p-4 ring-1 ring-foreground/10"
    >
      <QuestionnaireProgress />
      <QuestionnaireItem name="next-step" required>
        <QuestionnaireTitle>What should I do next?</QuestionnaireTitle>
        <QuestionnaireDescription>I can draft a fix, or keep an eye on it.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="fix" defaultChecked>
            Draft a fix for folio-api
            <QuestionnaireChoiceDescription>Export in batches of 500 rows again.</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="watch">
            Tell me if it happens again
            <QuestionnaireChoiceDescription>Within a minute of the first failed export.</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="nothing">Nothing for now</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireItem name="who" multiple>
        <QuestionnaireTitle>Who else should hear about it?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="on-call">Whoever is on call</QuestionnaireChoice>
          <QuestionnaireChoice value="api-owners">The people who look after folio-api</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit>Send</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}

function Conversation() {
  return (
    <div className="flex h-[760px] min-w-0 flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
      <MessageScrollerProvider defaultScrollPosition="start">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Conversation with Cluenori">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl p-4 md:p-6">
              <MessageScrollerItem messageId="marker">
                <Marker variant="separator">
                  <MarkerContent>Today</MarkerContent>
                </Marker>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="question" scrollAnchor>
                <Message align="end">
                  <MessageContent>
                    <Bubble align="end">
                      <BubbleContent>Why did exports fail this morning?</BubbleContent>
                    </Bubble>
                    <MessageFooter>{clockTime(askedAt)}</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="answer">
                <Message>
                  <MessageAvatar className="size-8">
                    <SparklesIcon className="size-4" />
                  </MessageAvatar>
                  <MessageContent>
                    <MessageHeader>Cluenori</MessageHeader>
                    <WhatWasChecked />
                    <Bubble variant="ghost">
                      <BubbleContent>
                        <p>
                          For 40 minutes, from {clockTime(incident.from)} to {clockTime(incident.to)}, folio-api
                          couldn't read from Postgres in time. Every failed POST /api/export ended in NpgsqlException:
                          Exception while reading from stream.
                        </p>
                        <p className="mt-3">
                          It started 4 minutes after release 2.14.0+412, which exports a whole project in one query
                          instead of 500 rows at a time. Large exports held their connection until the database gave up.
                          Since {clockTime(incident.to)} exports work again.
                        </p>
                      </BubbleContent>
                    </Bubble>
                    <AttachmentGroup>
                      <Attachment>
                        <AttachmentMedia>
                          <FileTextIcon />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>folio-api.log</AttachmentTitle>
                          <AttachmentDescription>
                            {count(212)} lines from {clockTime(incident.from)}
                          </AttachmentDescription>
                        </AttachmentContent>
                        <AttachmentActions>
                          <AttachmentAction aria-label="Download the log">
                            <DownloadIcon />
                          </AttachmentAction>
                        </AttachmentActions>
                      </Attachment>
                      <Attachment>
                        <AttachmentTrigger
                          render={<Link to={{ page: "trace", project: sampleProject, trace: sampleTrace.trace }} />}
                          aria-label="Open the trace"
                        />
                        <AttachmentMedia>
                          <ActivityIcon />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>A failed export</AttachmentTitle>
                          <AttachmentDescription>Trace {sampleTrace.trace.slice(0, 8)}</AttachmentDescription>
                        </AttachmentContent>
                      </Attachment>
                      <Attachment state="uploading">
                        <AttachmentMedia>
                          <FileCodeIcon />
                        </AttachmentMedia>
                        <AttachmentContent>
                          <AttachmentTitle>ExportService.cs</AttachmentTitle>
                          <AttachmentDescription>Reading the code</AttachmentDescription>
                        </AttachmentContent>
                      </Attachment>
                    </AttachmentGroup>
                    <Bubble variant="ghost">
                      <BubbleContent>To check that traces arrive again, send one by hand:</BubbleContent>
                    </Bubble>
                    <TestTraceBlock />
                    <MessageFooter>Answered in {duration(6_200)}</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="next-step">
                <Message>
                  <MessageAvatar className="size-8">
                    <SparklesIcon className="size-4" />
                  </MessageAvatar>
                  <MessageContent>
                    <NextStep />
                  </MessageContent>
                </Message>
              </MessageScrollerItem>

              <MessageScrollerItem messageId="working">
                <Marker>
                  <MarkerIcon>
                    <MessageCircleIcon />
                  </MarkerIcon>
                  <MarkerContent>Cluenori keeps this conversation with the project folio.</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="border-t p-3">
        <InputGroup className="rounded-2xl">
          <InputGroupTextarea placeholder="Ask about folio" aria-label="Ask Cluenori" />
          <InputGroupAddon align="block-end">
            <InputGroupButton size="icon-xs" aria-label="Attach a file">
              <PaperclipIcon />
            </InputGroupButton>
            <InputGroupText className="ml-auto text-xs">folio in production</InputGroupText>
            <InputGroupButton size="icon-xs" variant="default" aria-label="Send">
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}

/** The views a conversation with Cluenori is made of. */
export function KitAssistant() {
  return (
    <KitGroup
      id="assistant"
      title="Assistant"
      description="A conversation with Cluenori: a question, what it checked, its answer with a log and code, and a question back."
    >
      <KitCard
        wide
        title="Conversation"
        description="Scroll it: the button at the bottom jumps to the newest message."
        files={[
          "message-scroller.tsx",
          "message.tsx",
          "bubble.tsx",
          "trace.tsx",
          "attachment.tsx",
          "code-block.tsx",
          "questionnaire.tsx",
          "marker.tsx",
        ]}
      >
        <Conversation />
      </KitCard>

      <KitCard title="Bubble" description="Every variant, with reactions on one." files={["bubble.tsx"]}>
        <div className="flex flex-col gap-4">
          {bubbleVariants.map((variant) => (
            <KitSample key={variant} label={variant}>
              <Bubble variant={variant}>
                <BubbleContent>Exports work again since {clockTime(incident.to)}.</BubbleContent>
                {variant === "secondary" && (
                  <BubbleReactions>
                    <ThumbsUpIcon className="size-3.5" />
                    <span className="text-xs tabular-nums">{count(2)}</span>
                  </BubbleReactions>
                )}
              </Bubble>
            </KitSample>
          ))}
        </div>
      </KitCard>

      <KitCard
        title="Code block and marker"
        description="Code with changed lines, an error, and the small notes between messages."
        files={["code-block.tsx", "marker.tsx"]}
      >
        <CodeBlock>
          <CodeBlockHeader>
            <CodeBlockTitle>
              <FileCodeIcon />
              ExportService.cs
            </CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent lineNumbers startLine={41}>
            <CodeBlockLine>public async Task BuildAsync(ExportRequest request)</CodeBlockLine>
            <CodeBlockLine>{"{"}</CodeBlockLine>
            <CodeBlockLine variant="removed">
              {"    var notes = await repository.ListAllAsync(request.Project);"}
            </CodeBlockLine>
            <CodeBlockLine variant="added">
              {"    await foreach (var notes in repository.ListInBatchesAsync(request.Project, 500))"}
            </CodeBlockLine>
            <CodeBlockLine variant="highlighted">{"        writer.Write(notes);"}</CodeBlockLine>
            <CodeBlockLine>{"}"}</CodeBlockLine>
          </CodeBlockContent>
        </CodeBlock>
        <CodeBlock variant="destructive" size="sm">
          <CodeBlockHeader>
            <CodeBlockTitle>
              <BugIcon />
              NpgsqlException
            </CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent wrap>{stackHead}</CodeBlockContent>
        </CodeBlock>
        <div className="flex flex-col gap-4">
          <Marker variant="separator">
            <MarkerContent>Yesterday</MarkerContent>
          </Marker>
          <Marker>
            <MarkerIcon>
              <SparklesIcon />
            </MarkerIcon>
            <MarkerContent>Cluenori looked at the last day of folio-api.</MarkerContent>
          </Marker>
          <Marker variant="border">
            <MarkerContent>Earlier messages are kept for 90 days.</MarkerContent>
          </Marker>
        </div>
      </KitCard>
    </KitGroup>
  )
}
