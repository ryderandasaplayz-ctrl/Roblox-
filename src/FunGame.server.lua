-- "Sky Rush" Obby -- put this Script in ServerScriptService and press Play.
-- Builds everything automatically: rainbow obby, coins, jump pads, speed pads,
-- lava, spinners, checkpoints, a leaderboard, and saving.

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")
local store = DataStoreService:GetDataStore("SkyRushV1")

local map = Instance.new("Folder"); map.Name = "SkyRush"; map.Parent = workspace
local checkpoints = {}

local function part(props)
	local p = Instance.new("Part")
	p.Anchored = true; p.TopSurface = Enum.SurfaceType.Smooth
	for k, v in pairs(props) do p[k] = v end
	p.Parent = map
	return p
end

local function rainbow(i) return Color3.fromHSV((i * 0.07) % 1, 0.8, 1) end

-- Spawn
local spawn = Instance.new("SpawnLocation")
spawn.Size = Vector3.new(16, 1, 16); spawn.Position = Vector3.new(0, 50, 0)
spawn.Anchored = true; spawn.Color = Color3.new(1, 1, 1); spawn.Parent = map
checkpoints[0] = spawn

local function getStage(plr) return plr.leaderstats.Stage end

local pos = Vector3.new(0, 50, 0)
for i = 1, 40 do
	local kind = i % 8
	pos = pos + Vector3.new(math.random(-4, 4), math.random(-1, 3), -(14 + math.random(0, 6)))
	local p = part({ Size = Vector3.new(8, 1, 8), Position = pos, Color = rainbow(i), Material = Enum.Material.Neon })

	if i % 5 == 0 then -- checkpoint
		p.Size = Vector3.new(12, 1, 12); p.Color = Color3.fromRGB(0, 255, 120)
		local stage = i / 5
		checkpoints[stage] = p
		p.Touched:Connect(function(hit)
			local plr = Players:GetPlayerFromCharacter(hit.Parent)
			if plr and getStage(plr).Value < stage then
				getStage(plr).Value = stage
				plr.leaderstats.Coins.Value += 25
			end
		end)
	elseif kind == 2 then -- jump pad
		p.Color = Color3.fromRGB(255, 0, 255)
		p.Touched:Connect(function(hit)
			local root = hit.Parent:FindFirstChild("HumanoidRootPart")
			if root then root.AssemblyLinearVelocity = Vector3.new(0, 90, -40) end
		end)
	elseif kind == 4 then -- lava with a narrow safe beam
		p.Color = Color3.fromRGB(255, 60, 0); p.Material = Enum.Material.Neon
		part({ Size = Vector3.new(1.5, 1.2, 8), Position = pos + Vector3.new(0, 0.2, 0), Color = Color3.new(1, 1, 1) })
		p.Touched:Connect(function(hit)
			local h = hit.Parent:FindFirstChildOfClass("Humanoid")
			if h then h.Health = 0 end
		end)
	elseif kind == 6 then -- spinner
		local bar = part({ Size = Vector3.new(14, 1, 1), Position = pos + Vector3.new(0, 2, 0), Color = Color3.new(1, 0, 0), CanCollide = false })
		local a = 0
		RunService.Heartbeat:Connect(function(dt)
			a += dt * 2.5
			bar.CFrame = CFrame.new(pos + Vector3.new(0, 2, 0)) * CFrame.Angles(0, a, 0)
		end)
		bar.Touched:Connect(function(hit)
			local root = hit.Parent:FindFirstChild("HumanoidRootPart")
			if root then root.AssemblyLinearVelocity = bar.CFrame.LookVector * 80 + Vector3.new(0, 40, 0) end
		end)
	elseif kind == 7 then -- speed pad
		p.Color = Color3.fromRGB(0, 200, 255)
		p.Touched:Connect(function(hit)
			local h = hit.Parent:FindFirstChildOfClass("Humanoid")
			if h and h.WalkSpeed < 40 then
				h.WalkSpeed = 40
				task.delay(4, function() if h.Parent then h.WalkSpeed = 16 end end)
			end
		end)
	end

	-- spinning coin
	local coin = part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 3, 3), Position = pos + Vector3.new(0, 4, 0),
		Color = Color3.fromRGB(255, 215, 0), Material = Enum.Material.Neon, CanCollide = false })
	local base, taken = coin.CFrame, false
	RunService.Heartbeat:Connect(function()
		coin.CFrame = base * CFrame.new(0, math.sin(os.clock() * 3) * 0.5, 0) * CFrame.Angles(0, os.clock() * 3, math.rad(90))
	end)
	coin.Touched:Connect(function(hit)
		local plr = Players:GetPlayerFromCharacter(hit.Parent)
		if plr and not taken then
			taken = true; coin.Transparency = 1
			plr.leaderstats.Coins.Value += 5
			task.delay(10, function() taken = false; coin.Transparency = 0 end)
		end
	end)
end

-- Finish: trophy platform, big reward, confetti, send back to start
local finish = part({ Size = Vector3.new(20, 1, 20), Position = pos + Vector3.new(0, 0, -25), Color = Color3.fromRGB(255, 215, 0), Material = Enum.Material.Neon })
local done = {}
finish.Touched:Connect(function(hit)
	local plr = Players:GetPlayerFromCharacter(hit.Parent)
	if plr and not done[plr] then
		done[plr] = true
		plr.leaderstats.Coins.Value += 500
		plr.leaderstats.Wins.Value += 1
		local fx = Instance.new("ParticleEmitter"); fx.Rate = 200; fx.Speed = NumberRange.new(20)
		fx.Color = ColorSequence.new(Color3.new(1, 0, 0), Color3.new(0, 0, 1)); fx.Parent = finish
		task.delay(3, function()
			fx:Destroy()
			getStage(plr).Value = 0
			plr:LoadCharacter()
			done[plr] = nil
		end)
	end
end)

-- Leaderboard + saving + respawn at checkpoint
Players.PlayerAdded:Connect(function(plr)
	local ls = Instance.new("Folder"); ls.Name = "leaderstats"; ls.Parent = plr
	for _, n in ipairs({ "Stage", "Coins", "Wins" }) do
		local v = Instance.new("IntValue"); v.Name = n; v.Parent = ls
	end
	local ok, data = pcall(function() return store:GetAsync(plr.UserId) end)
	if ok and data then
		ls.Stage.Value, ls.Coins.Value, ls.Wins.Value = data.Stage or 0, data.Coins or 0, data.Wins or 0
	end
	plr.CharacterAdded:Connect(function(char)
		local cp = checkpoints[ls.Stage.Value] or spawn
		task.wait()
		char:PivotTo(cp.CFrame + Vector3.new(0, 4, 0))
		-- Coins = speed bonus! every 200 coins gives +1 walkspeed (max +8)
		local h = char:WaitForChild("Humanoid")
		h.WalkSpeed = 16 + math.min(8, math.floor(ls.Coins.Value / 200))
	end)
end)

Players.PlayerRemoving:Connect(function(plr)
	local ls = plr:FindFirstChild("leaderstats")
	if ls then
		pcall(function()
			store:SetAsync(plr.UserId, { Stage = ls.Stage.Value, Coins = ls.Coins.Value, Wins = ls.Wins.Value })
		end)
	end
end)
