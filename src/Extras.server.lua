-- Sky Rush EXTRAS (Script in ServerScriptService, next to FunGame)
-- Shop (tap-friendly prompts), saved items, random events, sounds, timer.

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local itemStore = DataStoreService:GetDataStore("SkyRushItemsV1")

local map = workspace:WaitForChild("SkyRush")
local owned = {} -- [plr] = {ItemName = true}

local function sound(id, parent, vol)
	local s = Instance.new("Sound"); s.SoundId = "rbxassetid://" .. id; s.Volume = vol or 0.6
	s.Parent = parent; s:Play(); game:GetService("Debris"):AddItem(s, 5)
end

local function announce(text)
	for _, plr in ipairs(Players:GetPlayers()) do
		local gui = Instance.new("ScreenGui"); gui.Name = "Announce"; gui.ResetOnSpawn = false
		local t = Instance.new("TextLabel"); t.Size = UDim2.fromScale(0.8, 0.1); t.Position = UDim2.fromScale(0.1, 0.12)
		t.BackgroundTransparency = 1; t.TextScaled = true; t.Font = Enum.Font.FredokaOne
		t.TextColor3 = Color3.new(1, 1, 0); t.TextStrokeTransparency = 0; t.Text = text; t.Parent = gui
		gui.Parent = plr.PlayerGui
		game:GetService("Debris"):AddItem(gui, 4)
	end
end

------------------------------------------------------------------ ITEMS
local ITEMS = {
	{ name = "Rainbow Trail", price = 100,  color = Color3.fromRGB(255, 0, 200) },
	{ name = "Speed Coil",    price = 250,  color = Color3.fromRGB(0, 200, 255) },
	{ name = "Gravity Coil",  price = 300,  color = Color3.fromRGB(150, 0, 255) },
	{ name = "Double Jump",   price = 500,  color = Color3.fromRGB(255, 255, 0) },
	{ name = "Giant Mode",    price = 1000, color = Color3.fromRGB(255, 80, 0) },
}

local function applyItems(plr, char)
	local items = owned[plr] or {}
	local h = char:WaitForChild("Humanoid")
	local root = char:WaitForChild("HumanoidRootPart")
	if items["Rainbow Trail"] then
		local a0 = Instance.new("Attachment", root); a0.Position = Vector3.new(0, 1, 0)
		local a1 = Instance.new("Attachment", root); a1.Position = Vector3.new(0, -1, 0)
		local tr = Instance.new("Trail"); tr.Attachment0 = a0; tr.Attachment1 = a1; tr.Lifetime = 0.8
		tr.Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.new(1, 0, 0)), ColorSequenceKeypoint.new(0.5, Color3.new(0, 1, 0)),
			ColorSequenceKeypoint.new(1, Color3.new(0, 0, 1)) })
		tr.Parent = root
	end
	if items["Speed Coil"] then
		task.wait(0.2)
		h.WalkSpeed += 8
		h:SetAttribute("BaseSpeed", h.WalkSpeed)
	end
	if items["Gravity Coil"] then
		local att = Instance.new("Attachment", root)
		local vf = Instance.new("VectorForce"); vf.Attachment0 = att; vf.RelativeTo = Enum.ActuatorRelativeTo.World
		local mass = 0
		for _, p in ipairs(char:GetDescendants()) do if p:IsA("BasePart") then mass += p:GetMass() end end
		vf.Force = Vector3.new(0, mass * workspace.Gravity * 0.4, 0); vf.Parent = root
	end
	if items["Double Jump"] then plr:SetAttribute("DoubleJump", true) end
	if items["Giant Mode"] then
		task.wait(0.2)
		pcall(function() char:ScaleTo(1.6) end)
	end
end

-- Shop island next to the spawn
local shopBase = Instance.new("Part"); shopBase.Anchored = true; shopBase.Size = Vector3.new(30, 1, 16)
shopBase.Position = Vector3.new(25, 50, 0); shopBase.Color = Color3.fromRGB(60, 60, 90)
shopBase.Material = Enum.Material.SmoothPlastic; shopBase.Parent = map

local sign = Instance.new("BillboardGui"); sign.Size = UDim2.fromScale(12, 3); sign.StudsOffset = Vector3.new(0, 10, 0)
sign.AlwaysOnTop = true; sign.Parent = shopBase
local st = Instance.new("TextLabel"); st.Size = UDim2.fromScale(1, 1); st.BackgroundTransparency = 1
st.Text = "🛒 SHOP"; st.TextScaled = true; st.Font = Enum.Font.FredokaOne; st.TextColor3 = Color3.new(1, 1, 0)
st.TextStrokeTransparency = 0; st.Parent = sign

for i, item in ipairs(ITEMS) do
	local stand = Instance.new("Part"); stand.Anchored = true; stand.Size = Vector3.new(4, 4, 4)
	stand.Position = shopBase.Position + Vector3.new(-12 + (i - 1) * 6, 2.5, -4)
	stand.Color = item.color; stand.Material = Enum.Material.Neon; stand.Parent = map
	local pp = Instance.new("ProximityPrompt")
	pp.ActionText = "Buy (" .. item.price .. " coins)"; pp.ObjectText = item.name
	pp.ClickablePrompt = true; pp.RequiresLineOfSight = false; pp.MaxActivationDistance = 12
	pp.Parent = stand
	pp.Triggered:Connect(function(plr)
		owned[plr] = owned[plr] or {}
		local coins = plr.leaderstats.Coins
		if owned[plr][item.name] then
			announce(plr.Name .. " already owns " .. item.name .. "!")
		elseif coins.Value >= item.price then
			coins.Value -= item.price
			owned[plr][item.name] = true
			sound(4612375233, stand, 1)
			if plr.Character then task.spawn(applyItems, plr, plr.Character) end
			announce("🎉 " .. plr.Name .. " bought " .. item.name .. "!")
		else
			sound(550209561, stand)
		end
	end)
end

------------------------------------------------------------------ PLAYERS
Players.PlayerAdded:Connect(function(plr)
	local ok, data = pcall(function() return itemStore:GetAsync(plr.UserId) end)
	owned[plr] = (ok and data) or {}
	plr.CharacterAdded:Connect(function(char) applyItems(plr, char) end)
	if plr.Character then applyItems(plr, plr.Character) end
end)

Players.PlayerRemoving:Connect(function(plr)
	local items = owned[plr]
	if items then pcall(function() itemStore:SetAsync(plr.UserId, items) end) end
	owned[plr] = nil
end)

------------------------------------------------------------------ RANDOM EVENTS (every 90s)
local EVENTS = {
	function() -- Coin rain
		announce("💰 COIN RAIN! Grab them!")
		for _ = 1, 60 do
			local c = Instance.new("Part"); c.Shape = Enum.PartType.Ball; c.Size = Vector3.new(2, 2, 2)
			c.Color = Color3.fromRGB(255, 215, 0); c.Material = Enum.Material.Neon
			c.Position = Vector3.new(math.random(-20, 40), 120, math.random(-300, 10)); c.Parent = map
			c.Touched:Connect(function(hit)
				local plr = Players:GetPlayerFromCharacter(hit.Parent)
				if plr and c.Parent then plr.leaderstats.Coins.Value += 10; c:Destroy() end
			end)
			game:GetService("Debris"):AddItem(c, 20)
			task.wait(0.15)
		end
	end,
	function() -- Low gravity
		announce("🌙 LOW GRAVITY for 30 seconds!")
		workspace.Gravity = 60; task.wait(30); workspace.Gravity = 196.2
		announce("Gravity is back to normal")
	end,
	function() -- Speed frenzy
		announce("⚡ SPEED FRENZY! Everyone is FAST!")
		for _, plr in ipairs(Players:GetPlayers()) do
			local h = plr.Character and plr.Character:FindFirstChildOfClass("Humanoid")
			if h then h.WalkSpeed = 45 end
		end
		task.wait(20)
		for _, plr in ipairs(Players:GetPlayers()) do
			local h = plr.Character and plr.Character:FindFirstChildOfClass("Humanoid")
			if h then h.WalkSpeed = h:GetAttribute("BaseSpeed") or 16 end
		end
	end,
	function() -- Double coins
		announce("✨ DOUBLE COINS for 30 seconds!")
		local conns = {}
		for _, plr in ipairs(Players:GetPlayers()) do
			local coins = plr.leaderstats.Coins; local last = coins.Value; local busy = false
			conns[#conns + 1] = coins.Changed:Connect(function(v)
				if busy then return end
				if v > last then busy = true; coins.Value += (v - last); busy = false end
				last = coins.Value
			end)
		end
		task.wait(30)
		for _, c in ipairs(conns) do c:Disconnect() end
	end,
}

task.spawn(function()
	while true do
		task.wait(90)
		EVENTS[math.random(#EVENTS)]()
	end
end)
