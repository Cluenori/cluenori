import CluenoriScreens
import SwiftUI

/// The app's look, the founder's palette: near-black panels with thin borders on a dark ground,
/// white text, gray for what's secondary, a pastel for each state, and white for the one primary
/// button. The app always shows dark (`CluenoriRootView`).
enum Palette {
    static let ground = Color(hex: 0x0B0B0C)
    static let panel = Color(hex: 0x141416)
    static let border = Color(hex: 0x232327)
    static let divider = Color(hex: 0x1F1F22)
    static let text = Color(hex: 0xF5F5F7)
    static let secondary = Color(hex: 0x9A9AA0)
    /// Calm, and more than before.
    static let mint = Color(hex: 0x86EFAC)
    /// Load.
    static let sky = Color(hex: 0x7DD3FC)
    /// Links, and the tech door.
    static let blue = Color(hex: 0x93C5FD)
    /// Releases.
    static let purple = Color(hex: 0xC4B5FD)
    /// Slower, warnings, and less than before.
    static let yellow = Color(hex: 0xFDE68A)
    /// Errors.
    static let pink = Color(hex: 0xF9A8D4)
    /// Incidents.
    static let red = Color(hex: 0xFCA5A5)
    /// The corners of panels and buttons.
    static let radius: CGFloat = 14
}

extension Color {
    /// A color in sRGB from its hex value, `0x86EFAC`.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// A panel: near-black with a thin border, its rows divided by thin lines (`PanelDivider`).
struct Panel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.panel)
        .clipShape(.rect(cornerRadius: Palette.radius))
        .overlay {
            RoundedRectangle(cornerRadius: Palette.radius)
                .strokeBorder(Palette.border, lineWidth: 1)
        }
    }
}

/// The thin line between two rows of a panel.
struct PanelDivider: View {
    var body: some View {
        Rectangle()
            .fill(Palette.divider)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

/// The title over a panel, small and gray in capitals, with what it covers at its end.
struct PanelTitle: View {
    let title: Text
    var trailing: Text? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            title
                .textCase(.uppercase)
                .font(.footnote.weight(.semibold))
                .tracking(0.6)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let trailing {
                trailing
                    .font(.footnote)
                    .multilineTextAlignment(.trailing)
            }
        }
        .foregroundStyle(Palette.secondary)
        .padding(.horizontal, 2)
        .padding(.bottom, 8)
    }
}

/// A row of a panel that opens something: white text, the whole row tappable, a darker panel while
/// pressed.
struct PanelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Palette.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .background(configuration.isPressed ? Palette.border : .clear)
    }
}

/// The last row of a panel: the way to all of what it shows the latest of, `All errors`, in blue.
struct AllRow: View {
    let title: Text
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            title
                .font(.subheadline)
                .foregroundStyle(Palette.blue)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .buttonStyle(PanelRowStyle())
    }
}

/// A small round dot in a state's color.
struct Dot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A dot beside the first line of a row's text, centered on its letters at every text size: for an
/// `HStack` aligned on `.firstTextBaseline`.
struct BaselineDot: View {
    let color: Color
    // How far the middle of the line's letters is above its baseline: about a third of the text's
    // size, scaled with it.
    @ScaledMetric private var lift: CGFloat

    init(color: Color, textStyle: Font.TextStyle) {
        self.color = color
        _lift = ScaledMetric(wrappedValue: textStyle == .callout ? 5.5 : 4.5, relativeTo: textStyle)
    }

    var body: some View {
        // Read here, on the main actor, for the guide's closure, which may run elsewhere.
        let lift = lift
        Dot(color: color)
            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + lift }
    }
}

/// The one primary action of a screen: white, full width.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(isEnabled ? Palette.ground : Palette.secondary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                isEnabled ? Palette.text.opacity(configuration.isPressed ? 0.8 : 1) : Palette.border,
                in: .rect(cornerRadius: Palette.radius))
    }
}

/// A screen of panels on the dark ground, scrolling, with the iPhone's side margins.
struct PanelScreen<Content: View>: View {
    var spacing: CGFloat = 28
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: spacing) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .background(Palette.ground)
    }
}

extension TodayRow.Kind {
    /// Its color: red for an incident, pink for an error, yellow for a slower operation, purple for
    /// a release, gray for silence and what this version doesn't know.
    var color: Color {
        switch self {
        case .incident: Palette.red
        case .error: Palette.pink
        case .slower: Palette.yellow
        case .promotion: Palette.purple
        case .silent, .unknown: Palette.secondary
        }
    }
}

/// How long ago `date` was, in its largest unit, as a row's corner says it: `4 min`, `2 hr`,
/// `3 days`; `now` under a minute.
func agoText(_ date: Date, now: Date = .now) -> Text {
    let seconds = now.timeIntervalSince(date)
    guard seconds >= 60 else {
        return Text("now", bundle: #bundle, comment: "When something happened: under a minute ago.")
    }
    return Text(
        Duration.seconds(seconds),
        format: .units(allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 1)
    )
}

/// A change against a week before, as a share, signed: `+6%`, `−2%`, `+0%`.
func changeText(_ change: Double) -> Text {
    Text(change, format: .percent.precision(.fractionLength(0)).sign(strategy: .always(includingZero: true)))
}

/// The color of a change against a week before: mint when up, yellow when down, gray under half a
/// percent either way.
func changeColor(_ change: Double) -> Color {
    abs(change) < 0.005 ? Palette.secondary : change > 0 ? Palette.mint : Palette.yellow
}
