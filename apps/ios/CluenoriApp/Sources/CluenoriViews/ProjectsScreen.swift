import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The paired deployment's projects, refreshed by pulling down, with the phone's settings.
struct ProjectsScreen: View {
    let projects: ProjectsModel
    let pairing: PairingModel

    var body: some View {
        ProjectList(projects: projects)
            .navigationTitle(Text("Projects", bundle: #bundle, comment: "Title of the list of projects."))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    PhoneMenu(pairing: pairing)
                }
            }
            .refreshable { await projects.load() }
            .task { await projects.load() }
            .safeAreaInset(edge: .bottom) {
                ProblemBanner(projects: projects, pairing: pairing)
            }
    }
}

struct ProjectList: View {
    let projects: ProjectsModel

    var body: some View {
        if let list = projects.projects {
            if list.isEmpty {
                ContentUnavailableView {
                    Label {
                        Text("No projects yet", bundle: #bundle, comment: "The deployment has no projects.")
                    } icon: {
                        Image(systemName: "folder")
                    }
                } description: {
                    Text(
                        "Create one from a terminal, in Cluenori's folder: ./cluenori project create",
                        bundle: #bundle,
                        comment: "How to create the first project."
                    )
                }
            } else {
                List(list, id: \.key) { project in
                    NavigationLink(value: Route.project(project.key)) {
                        ProjectRow(name: project.name, key: project.key)
                    }
                }
            }
        } else if projects.problem != nil {
            ContentUnavailableView {
                Label {
                    Text("No projects to show", bundle: #bundle, comment: "The projects couldn't be loaded.")
                } icon: {
                    Image(systemName: "wifi.exclamationmark")
                }
            } description: {
                Text("Pull down to try again.", bundle: #bundle, comment: "How to ask for the projects again.")
            }
        } else {
            ProgressView()
        }
    }
}

struct ProjectRow: View {
    let name: String
    let key: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(.body)
            Text(key)
                .font(.footnote.monospaced())
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Why what shows may be out of date, or why unpairing didn't happen, over the bottom of the list.
struct ProblemBanner: View {
    let projects: ProjectsModel
    let pairing: PairingModel

    var body: some View {
        if pairing.problem == .unreachable || projects.problem == .unreachable {
            BannerText(systemImage: "wifi.exclamationmark") {
                Text(
                    "Cluenori didn't answer. Showing what was here before.",
                    bundle: #bundle,
                    comment: "Banner when the phone is offline or the deployment is down."
                )
            }
        } else if pairing.problem != nil || projects.problem != nil {
            BannerText(systemImage: "exclamationmark.triangle") {
                Text(
                    "Cluenori answered in a way this version doesn't understand. Update the app.",
                    bundle: #bundle,
                    comment: "Banner when the deployment's answer couldn't be read."
                )
            }
        }
    }
}

struct BannerText<Content: View>: View {
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        Label {
            content
        } icon: {
            Image(systemName: systemImage)
        }
        .font(.subheadline)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .glassEffect(in: .capsule)
        .padding(.bottom, 8)
    }
}

/// The phone's own settings: which deployment it is paired with, and unpairing it.
struct PhoneMenu: View {
    let pairing: PairingModel
    @State private var isConfirming = false

    var body: some View {
        Menu {
            if let host = pairing.host {
                Section {
                    Text("Paired with \(host)", bundle: #bundle, comment: "The deployment's address, in the menu.")
                }
            }
            Button(role: .destructive) {
                isConfirming = true
            } label: {
                Label {
                    Text("Unpair This iPhone", bundle: #bundle, comment: "Menu item that unpairs the phone.")
                } icon: {
                    Image(systemName: "iphone.slash")
                }
            }
        } label: {
            Label {
                Text("Settings", bundle: #bundle, comment: "The menu with the phone's settings.")
            } icon: {
                Image(systemName: "gearshape")
            }
        }
        .confirmationDialog(
            Text("Unpair this iPhone?", bundle: #bundle, comment: "Title of the confirmation before unpairing."),
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await pairing.unpair() }
            } label: {
                Text("Unpair", bundle: #bundle, comment: "Confirms unpairing the phone.")
            }
        } message: {
            Text(
                "Its key stops working, and it no longer shows your projects. To use it again, pair it again.",
                bundle: #bundle,
                comment: "What unpairing does."
            )
        }
    }
}
