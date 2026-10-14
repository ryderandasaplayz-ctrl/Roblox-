-- MobileUIFix (LocalScript) -> put in StarterPlayer > StarterPlayerScripts
-- 1) Rescales every ScreenGui to fit the screen (phones, tablets, PC)
-- 2) Makes ProximityPrompts tappable on mobile

local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local workspace = workspace

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Resolution you designed your UI at in Studio
local DESIGN_SIZE = Vector2.new(1920, 1080)
local MIN_SCALE, MAX_SCALE = 0.45, 1.25

local function getScale()
	local vp = workspace.CurrentCamera.ViewportSize
	local s = math.min(vp.X / DESIGN_SIZE.X, vp.Y / DESIGN_SIZE.Y)
	return math.clamp(s, MIN_SCALE, MAX_SCALE)
end

local function fixGui(gui)
	if not gui:IsA("ScreenGui") then return end
	gui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets -- avoid notch / Roblox buttons
	gui.IgnoreGuiInset = false
	local uiScale = gui:FindFirstChild("AutoUIScale") or Instance.new("UIScale")
	uiScale.Name = "AutoUIScale"
	uiScale.Scale = getScale()
	uiScale.Parent = gui
	-- buttons: make sure taps register (touch fires Activated, not mouse events)
	for _, d in ipairs(gui:GetDescendants()) do
		if d:IsA("GuiButton") then
			d.Active = true
		end
	end
end

local function rescaleAll()
	local s = getScale()
	for _, gui in ipairs(playerGui:GetChildren()) do
		local u = gui:FindFirstChild("AutoUIScale")
		if u then u.Scale = s end
	end
end

for _, gui in ipairs(playerGui:GetChildren()) do fixGui(gui) end
playerGui.ChildAdded:Connect(fixGui)
workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescaleAll)

-- Proximity prompts: tappable on touch screens
local function fixPrompt(p)
	if not p:IsA("ProximityPrompt") then return end
	p.ClickablePrompt = true
	p.RequiresLineOfSight = false
	if p.Style == Enum.ProximityPromptStyle.Custom then
		p.Style = Enum.ProximityPromptStyle.Default
	end
	if p.MaxActivationDistance < 10 then
		p.MaxActivationDistance = 10
	end
end

for _, d in ipairs(workspace:GetDescendants()) do fixPrompt(d) end
workspace.DescendantAdded:Connect(fixPrompt)
ProximityPromptService.Enabled = true
